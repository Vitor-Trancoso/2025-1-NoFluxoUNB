import { EndpointController, RequestType } from "../interfaces";
import { Pair, Utils } from "../utils";
import { Request, Response } from "express";
import { SupabaseWrapper } from "../supabase_wrapper";
import axios from 'axios';
import FormData from 'form-data';
import { createControllerLogger } from '../utils/controller_logger';

// Helper interfaces for better type safety
interface DisciplinaHistorico {
    tipo_dado: string;
    nome: string;
    codigo: string;
    status: string;
    mencao?: string;
    creditos?: number;
    carga_horaria?: number;
    ano_periodo?: string;
    prefixo?: string;
    professor?: string;
}

interface MateriasBanco {
    id_materia: number;
    nivel: number;
    materias: {
        id_materia: number;
        nome_materia: string;
        codigo_materia: string;
    };
}

interface EquivalenciaData {
    id_equivalencia: number;
    id_materia: number;
    expressao: string;
}

// Helper function to extract subject codes from equivalency expressions
function extractSubjectCodes(expression: string): string[] {
    return Array.from(expression.matchAll(/[A-Z]{2,}\d{3,}/gi))
        .map((m: any) => m[0].replace(/\s+/g, '').toUpperCase());
}

// Helper function to get status priority for conflict resolution
function getStatusPriority(status: string): number {
    if (status === 'APR' || status === 'CUMP') return 3;
    if (status === 'MATR') return 2;
    return 1; // REP, etc.
}

// Helper function to match a discipline with bank subjects
function findSubjectMatch(
    disciplina: DisciplinaHistorico,
    materiasObrigatorias: MateriasBanco[],
    materiasOptativas: MateriasBanco[]
): MateriasBanco | null {
    // 1. Match by code in mandatory subjects
    let match = materiasObrigatorias.find((m: any) =>
        m.materias.codigo_materia && disciplina.codigo &&
        m.materias.codigo_materia.toLowerCase().trim() === disciplina.codigo.toLowerCase().trim()
    );

    // 2. Match by code in elective subjects
    if (!match) {
        match = materiasOptativas.find((m: any) =>
            m.materias.codigo_materia && disciplina.codigo &&
            m.materias.codigo_materia.toLowerCase().trim() === disciplina.codigo.toLowerCase().trim()
        );
    }

    // 3. Match by name in mandatory subjects
    if (!match) {
        match = materiasObrigatorias.find((m: any) =>
            m.materias.nome_materia.toLowerCase().trim() === disciplina.nome.toLowerCase().trim()
        );
    }

    // 4. Match by name in elective subjects  
    if (!match) {
        match = materiasOptativas.find((m: any) =>
            m.materias.nome_materia.toLowerCase().trim() === disciplina.nome.toLowerCase().trim()
        );
    }

    return match || null;
}

// Helper function to process matched disciplines and handle duplicates
function processMatchedDiscipline(
    disciplina: DisciplinaHistorico,
    materiaBanco: MateriasBanco,
    disciplinasCasadas: any[],
    logger: any
): any {
    logger.debug(`Processing matched discipline: "${disciplina.nome}" (ID: ${materiaBanco.id_materia}, Level: ${materiaBanco.nivel}, Status: ${disciplina.status})`);

    // Check for existing discipline with same ID
    const existingIndex = disciplinasCasadas.findIndex((d: any) => d.id_materia === materiaBanco.id_materia);

    const disciplinaCasada = {
        ...disciplina,
        id_materia: materiaBanco.id_materia,
        encontrada_no_banco: true,
        nivel: materiaBanco.nivel,
        tipo: materiaBanco.nivel === 0 ? 'optativa' : 'obrigatoria'
    };

    if (existingIndex >= 0) {
        const existing = disciplinasCasadas[existingIndex];
        const currentPriority = getStatusPriority(existing.status);
        const newPriority = getStatusPriority(disciplina.status);

        logger.debug(`Found existing discipline "${disciplina.nome}" - Current priority: ${currentPriority} (${existing.status}), New priority: ${newPriority} (${disciplina.status})`);

        if (newPriority > currentPriority) {
            disciplinasCasadas[existingIndex] = disciplinaCasada;
            logger.info(`Updating status for "${disciplina.nome}": ${existing.status} → ${disciplina.status}`);
        } else {
            logger.debug(`Keeping existing status for "${disciplina.nome}": ${existing.status} (priority ${currentPriority} >= ${newPriority})`);
        }
        return disciplinasCasadas[existingIndex];
    } else {
        disciplinasCasadas.push(disciplinaCasada);
        logger.debug(`Added new discipline "${disciplina.nome}" to disciplinasCasadas array (total: ${disciplinasCasadas.length})`);
        return disciplinaCasada;
    }
}

// Helper function to check equivalencies
function checkEquivalencies(
    disciplinasCasadas: any[],
    equivalencias: EquivalenciaData[],
    targetMateria: any,
    logger: any
): boolean {
    for (const eq of equivalencias) {
        const codigosEquivalentes = extractSubjectCodes(eq.expressao);
        for (const codigoEq of codigosEquivalentes) {
            const encontrada = disciplinasCasadas.find(
                d => d.codigo === codigoEq && (d.status === 'APR' || d.status === 'CUMP')
            );
            if (encontrada) {
                logger.info(`Subject '${targetMateria.nome}' completed by equivalency with '${encontrada.nome}' (${encontrada.codigo})`);
                return true;
            }
        }
    }
    return false;
}

export const FluxogramaController: EndpointController = {
    name: "fluxograma",
    routes: {
        "fluxograma": new Pair(RequestType.GET, async (req: Request, res: Response) => {
            const logger = createControllerLogger("FluxogramaController", "fluxograma");
            logger.info(`Buscando fluxograma para curso`);
            const nome_curso = req.query.nome_curso as string;

            logger.info(`Nome do curso: ${nome_curso}`);
            if (!nome_curso) {
                logger.error("Nome do curso não informado");
                return res.status(400).json({ error: "Nome do curso não informado" });
            }

            const { data, error } = await SupabaseWrapper.get().from("cursos").select("*,materias_por_curso(nivel,materias(*))").like("nome_curso", "%" + req.query.nome_curso + "%");

            if (error) {
                logger.error(`Erro ao buscar fluxograma: ${error.message}`);
                return res.status(500).json({ error: error.message });
            }

            for (const curso of data) {
                // get equivalencias
                const { data: equivalencias, error: errorEquivalencias } = await SupabaseWrapper.get()
                    .from("equivalencias")
                    .select("id_equivalencia,id_materia,expressao,materias(*)")
                    .or(`id_curso.is.null,id_curso.eq.${curso.id_curso}`)
                    .or(`matriz_curricular.is.null,matriz_curricular.eq.${curso.matriz_curricular}`);

                if (errorEquivalencias) {
                    logger.error(`Erro ao buscar equivalencias: ${errorEquivalencias.message}`);
                    return res.status(500).json({ error: errorEquivalencias.message });
                }

                var materias_id = [];

                for (const materia of curso.materias_por_curso) {
                    materias_id.push(materia.materias.id_materia);
                }

                // get pre-requisitos
                const { data: preRequisitos, error: errorPreRequisitos } = await SupabaseWrapper.get()
                    .from("pre_requisitos")
                    .select("id_pre_requisito,id_materia,id_materia_requisito,materias:id_materia_requisito(codigo_materia,nome_materia)")
                    .in("id_materia", materias_id);

                if (errorPreRequisitos) {
                    logger.error(`Erro ao buscar pre-requisitos: ${errorPreRequisitos.message}`);
                    return res.status(500).json({ error: errorPreRequisitos.message });
                }

                var preRequisitosCodigosComId = [];

                for (const preRequisito_ of preRequisitos) {
                    const preRequisito: any = preRequisito_;

                    if (preRequisito.id_materia_requisito) {
                        preRequisitosCodigosComId.push({
                            id_pre_requisito: preRequisito.id_pre_requisito,
                            id_materia: preRequisito.id_materia,
                            id_materia_requisito: preRequisito.id_materia_requisito,
                            codigo_materia_requisito: preRequisito.materias.codigo_materia,
                            nome_materia_requisito: preRequisito.materias.nome_materia
                        });
                    }
                }

                curso.pre_requisitos = preRequisitosCodigosComId;

                // get co-requisitos
                const { data: coRequisitos, error: errorCoRequisitos } = await SupabaseWrapper.get()
                    .from("co_requisitos")
                    .select("id_co_requisito,id_materia,id_materia_corequisito,materias:id_materia_corequisito(codigo_materia,nome_materia)")
                    .in("id_materia", materias_id);

                if (errorCoRequisitos) {
                    logger.error(`Erro ao buscar co-requisitos: ${errorCoRequisitos.message}`);
                    return res.status(500).json({ error: errorCoRequisitos.message });
                }

                var coRequisitosCodigosComId = [];
                for (const coRequisito_ of coRequisitos) {
                    const coRequisito: any = coRequisito_;
                    if (coRequisito.id_materia_corequisito) {
                        coRequisitosCodigosComId.push({
                            id_co_requisito: coRequisito.id_co_requisito,
                            id_materia: coRequisito.id_materia,
                            id_materia_corequisito: coRequisito.id_materia_corequisito,
                            codigo_materia_corequisito: coRequisito.materias.codigo_materia,
                            nome_materia_corequisito: coRequisito.materias.nome_materia
                        });
                    }
                }
                curso.co_requisitos = coRequisitosCodigosComId;

                curso.equivalencias = equivalencias;
            }

            return res.status(200).json(data);
        }),



        "read_pdf": new Pair(RequestType.POST, async (req: Request, res: Response) => {
            const logger = createControllerLogger("FluxogramaController", "read_pdf");
            logger.info("Iniciando leitura de PDF");
            try {
                if (!req.files || !req.files.pdf) {
                    logger.error("Arquivo PDF não enviado");
                    return res.status(400).json({ error: "Arquivo PDF não enviado." });
                }

                const pdfFile = Array.isArray(req.files.pdf) ? req.files.pdf[0] : req.files.pdf;
                const form = new FormData();
                form.append('pdf', pdfFile.data, pdfFile.name);

                logger.info(`Enviando PDF para processamento: ${pdfFile.name}`);
                // Envia para o Python com timeout de 30 segundos
                const response = await axios.post(
                    'http://127.0.0.1:3001/upload-pdf',
                    form,
                    {
                        headers: form.getHeaders(),
                        timeout: 30000, // 30 segundos
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity
                    }
                );

                logger.info("PDF processado com sucesso");
                // Retorna a resposta do Python para o frontend
                return res.status(200).json(response.data);
            } catch (error: any) {
                logger.error(`Erro ao processar PDF: ${error.message}`);
                if (error.code === 'ECONNREFUSED') {
                    return res.status(500).json({ error: 'Serviço de processamento de PDF não está disponível. Por favor, tente novamente em alguns instantes.' });
                }
                if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
                    return res.status(500).json({ error: 'O processamento do PDF demorou muito tempo. Por favor, tente novamente.' });
                }
                return res.status(500).json({ error: error.message || "Erro ao processar PDF" });
            }
        }),

        "casar_disciplinas": new Pair(RequestType.POST, async (req: Request, res: Response) => {
            const logger = createControllerLogger("FluxogramaController", "casar_disciplinas");
            const startTime = Date.now();
            logger.info("=== DISCIPLINE MATCHING STARTED ===");

            try {
                const { dados_extraidos } = req.body;

                if (!dados_extraidos) {
                    logger.error("Dados extraídos são obrigatórios");
                    return res.status(400).json({ error: "Dados extraídos são obrigatórios" });
                }

                // Log input data summary
                logger.info("=== INPUT DATA SUMMARY ===");
                logger.info(`Total extracted data items: ${dados_extraidos.extracted_data?.length || 0}`);

                // Extract basic information
                const curso_extraido = dados_extraidos.curso_extraido;
                const matriz_curricular = dados_extraidos.matriz_curricular;
                const media_ponderada = dados_extraidos.media_ponderada;
                const frequencia_geral = dados_extraidos.frequencia_geral;

                logger.info(`Curso extraído do PDF: "${curso_extraido}"`);
                logger.info(`Matriz curricular extraída: "${matriz_curricular}"`);
                logger.info(`Media ponderada: ${media_ponderada || 'Not available'}`);
                logger.info(`Frequência geral: ${frequencia_geral || 'Not available'}`);

                // Count different types of disciplines
                const disciplinaRegular = dados_extraidos.extracted_data?.filter((item: any) => item.tipo_dado === 'Disciplina Regular')?.length || 0;
                const disciplinaCump = dados_extraidos.extracted_data?.filter((item: any) => item.tipo_dado === 'Disciplina CUMP')?.length || 0;
                const otherItems = dados_extraidos.extracted_data?.filter((item: any) => item.tipo_dado !== 'Disciplina Regular' && item.tipo_dado !== 'Disciplina CUMP')?.length || 0;

                logger.info(`Disciplinas Regular: ${disciplinaRegular}`);
                logger.info(`Disciplinas CUMP: ${disciplinaCump}`);
                logger.info(`Other items: ${otherItems}`);
                logger.info("=== END INPUT SUMMARY ===");

                if (!curso_extraido) {
                    logger.warn("Curso não foi extraído do PDF automaticamente");
                    const { data: todosCursos } = await SupabaseWrapper.get()
                        .from("cursos")
                        .select("nome_curso, matriz_curricular")
                        .order("nome_curso");

                    return res.status(400).json({
                        error: "Curso não foi extraído do PDF automaticamente",
                        message: "Por favor, selecione o curso manualmente",
                        cursos_disponiveis: todosCursos || []
                    });
                }

                // Find course in database
                let materiasBanco = null;
                let error = null;

                // Handle keyword-based search
                if (curso_extraido.startsWith('PALAVRAS_CHAVE:')) {
                    const palavrasChave = curso_extraido.replace('PALAVRAS_CHAVE:', '').split(',');
                    logger.info(`Buscando cursos com palavras-chave: ${palavrasChave.join(', ')}`);

                    const { data: todosCursos } = await SupabaseWrapper.get()
                        .from("cursos")
                        .select("nome_curso, matriz_curricular")
                        .order("nome_curso");

                    if (todosCursos) {
                        const cursosFiltrados = todosCursos.filter(curso =>
                            palavrasChave.some((palavra: string) =>
                                curso.nome_curso?.toUpperCase().includes(palavra.toUpperCase())
                            )
                        );

                        if (cursosFiltrados.length === 1) {
                            const cursoSelecionado = cursosFiltrados[0];
                            logger.info(`Using filtered course: ${cursoSelecionado.nome_curso}`);

                            const { data, error: queryError } = await SupabaseWrapper.get()
                                .from("cursos")
                                .select("*,materias_por_curso(id_materia,nivel,materias(*))")
                                .eq("nome_curso", cursoSelecionado.nome_curso);

                            materiasBanco = data;
                            error = queryError;
                        } else if (cursosFiltrados.length > 1) {
                            return res.status(400).json({
                                error: "Múltiplos cursos encontrados",
                                message: "Por favor, selecione o curso correto",
                                cursos_disponiveis: cursosFiltrados,
                                palavras_chave_encontradas: palavrasChave
                            });
                        }
                    }
                } else {
                    // Normal course search
                    let query = SupabaseWrapper.get()
                        .from("cursos")
                        .select("*,materias_por_curso(id_materia,nivel,materias(*))")
                        .like("nome_curso", "%" + curso_extraido + "%");

                    if (matriz_curricular) {
                        query = query.eq("matriz_curricular", matriz_curricular);
                    }

                    const result = await query;
                    materiasBanco = result.data;
                    error = result.error;
                }

                if (error) {
                    logger.error(`Erro ao buscar matérias do curso: ${error.message}`);
                    return res.status(500).json({ error: error.message });
                }

                if (!materiasBanco || materiasBanco.length === 0) {
                    logger.error(`Curso não encontrado: ${curso_extraido}`);
                    const { data: todosCursos } = await SupabaseWrapper.get()
                        .from("cursos")
                        .select("nome_curso, matriz_curricular");

                    return res.status(404).json({
                        error: "Curso não encontrado",
                        curso_buscado: curso_extraido,
                        matriz_curricular_buscada: matriz_curricular,
                        cursos_disponiveis: todosCursos
                    });
                }

                const curso = materiasBanco[0];
                const materiasBancoList = curso.materias_por_curso;
                const materiasObrigatorias = materiasBancoList.filter((m: any) => m.nivel > 0);
                const materiasOptativas = materiasBancoList.filter((m: any) => m.nivel === 0);

                logger.info(`Course found: ${curso.nome_curso}`);
                logger.info(`Total subjects: ${materiasBancoList.length}`);
                logger.info(`Mandatory subjects: ${materiasObrigatorias.length}`);
                logger.info(`Elective subjects: ${materiasOptativas.length}`);

                // PRE-LOAD all equivalencies to avoid database queries in loops
                const { data: allEquivalencies } = await SupabaseWrapper.get()
                    .from("equivalencias")
                    .select("id_equivalencia,id_materia,expressao")
                    .or(`id_curso.is.null,id_curso.eq.${curso.id_curso}`);

                logger.info(`Loaded ${allEquivalencies?.length || 0} equivalencies`);

                // PRE-LOAD other course matrices to avoid database queries in loops
                const { data: outrasMatrizes } = await SupabaseWrapper.get()
                    .from("cursos")
                    .select("*,materias_por_curso(id_materia,nivel,materias(*))")
                    .eq("nome_curso", curso.nome_curso);

                logger.info(`Loaded ${outrasMatrizes?.length || 0} course matrices`);

                // Initialize result arrays
                const disciplinasCasadas: any[] = [];
                const materiasConcluidas: any[] = [];
                const materiasPendentes: any[] = [];
                const materiasOptativasConcluidas: any[] = [];
                const materiasOptativasPendentes: any[] = [];

                // Initialize validation data
                const dadosValidacao = {
                    ira: null as number | null,
                    media_ponderada: media_ponderada ? parseFloat(media_ponderada) : null,
                    frequencia_geral: frequencia_geral ? parseFloat(frequencia_geral) : null,
                    horas_integralizadas: 0,
                    pendencias: [],
                    curso_extraido: curso_extraido,
                    matriz_curricular: matriz_curricular
                };

                // Extract validation data
                for (const item of dados_extraidos.extracted_data) {
                    if (item.IRA) {
                        dadosValidacao.ira = parseFloat(item.valor);
                        logger.info(`IRA extracted: ${dadosValidacao.ira}`);
                    }
                    if (item.tipo_dado === 'Pendencias') {
                        dadosValidacao.pendencias = item.valores || [];
                        logger.info(`Pendencies extracted: ${dadosValidacao.pendencias}`);
                    }
                }

                // MAIN DISCIPLINE MATCHING LOOP - OPTIMIZED
                logger.info(`Starting discipline matching for ${dados_extraidos.extracted_data.length} extracted items`);
                let processedCount = 0;
                let foundCount = 0;
                let notFoundCount = 0;

                for (const disciplina of dados_extraidos.extracted_data) {
                    if (disciplina.tipo_dado === 'Disciplina Regular' || disciplina.tipo_dado === 'Disciplina CUMP') {
                        processedCount++;
                        logger.info(`Processing discipline ${processedCount}: "${disciplina.nome}" (${disciplina.codigo}) - Status: ${disciplina.status}`);

                        // 1. Try to match with primary matrix
                        logger.debug(`Attempting to match "${disciplina.nome}" with primary matrix`);
                        let materiaBanco = findSubjectMatch(disciplina, materiasObrigatorias, materiasOptativas);

                        if (materiaBanco) {
                            logger.info(`✓ Subject "${disciplina.nome}" found in primary matrix - ID: ${materiaBanco.id_materia}, Level: ${materiaBanco.nivel}`);
                        } else {
                            logger.debug(`✗ Subject "${disciplina.nome}" not found in primary matrix`);
                        }

                        // 2. Try to match with other matrices (pre-loaded, no DB query)
                        if (!materiaBanco && outrasMatrizes) {
                            logger.debug(`Attempting to match "${disciplina.nome}" with other matrices (${outrasMatrizes.length} matrices)`);
                            for (const matriz of outrasMatrizes) {
                                if (matriz.matriz_curricular === curso.matriz_curricular) continue;

                                const obrig = matriz.materias_por_curso.filter((m: any) => m.nivel > 0);
                                const opt = matriz.materias_por_curso.filter((m: any) => m.nivel === 0);

                                materiaBanco = findSubjectMatch(disciplina, obrig, opt);
                                if (materiaBanco) {
                                    logger.info(`✓ Subject "${disciplina.nome}" found in other matrix: ${matriz.matriz_curricular} - ID: ${materiaBanco.id_materia}`);
                                    break;
                                }
                            }
                            if (!materiaBanco) {
                                logger.debug(`✗ Subject "${disciplina.nome}" not found in any other matrix`);
                            }
                        }

                        // 3. Try to match with equivalencies (pre-loaded, no DB query)
                        if (!materiaBanco && allEquivalencies) {
                            logger.debug(`Attempting to match "${disciplina.nome}" with equivalencies (${allEquivalencies.length} equivalencies)`);
                            const equivalenciasMatch = allEquivalencies.filter(eq =>
                                eq.expressao && (
                                    eq.expressao.includes(disciplina.codigo) ||
                                    eq.expressao.includes(disciplina.nome)
                                )
                            );

                            if (equivalenciasMatch.length > 0) {
                                logger.debug(`Found ${equivalenciasMatch.length} potential equivalencies for "${disciplina.nome}"`);
                                // Find the target subject from the equivalency
                                const targetMateria = materiasBancoList.find((m: any) =>
                                    m.id_materia === equivalenciasMatch[0].id_materia
                                );

                                if (targetMateria) {
                                    materiaBanco = targetMateria;
                                    logger.info(`✓ Subject "${disciplina.nome}" matched by equivalency - Target: ${targetMateria.materias.nome_materia} (ID: ${targetMateria.id_materia})`);
                                } else {
                                    logger.debug(`✗ Equivalency target not found for "${disciplina.nome}"`);
                                }
                            } else {
                                logger.debug(`✗ No equivalencies found for "${disciplina.nome}"`);
                            }
                        }

                        // Process the match
                        if (materiaBanco) {
                            foundCount++;
                            logger.info(`Processing matched discipline "${disciplina.nome}" - Type: ${materiaBanco.nivel === 0 ? 'elective' : 'mandatory'}`);
                            processMatchedDiscipline(disciplina, materiaBanco, disciplinasCasadas, logger);
                        } else {
                            notFoundCount++;
                            // Subject not found
                            disciplinasCasadas.push({
                                ...disciplina,
                                id_materia: null,
                                encontrada_no_banco: false,
                                nivel: null,
                                tipo: 'nao_encontrada'
                            });
                            logger.warn(`✗ Subject not found: "${disciplina.nome}" (${disciplina.codigo})`);
                        }
                    }
                }

                logger.info(`Discipline matching completed - Processed: ${processedCount}, Found: ${foundCount}, Not found: ${notFoundCount}`)

                // CLASSIFY MATCHED DISCIPLINES
                logger.info(`Classifying ${disciplinasCasadas.length} matched disciplines`);
                let completedCount = 0;
                let inProgressCount = 0;
                let pendingCount = 0;
                let electivesCount = 0;
                let mandatoryCount = 0;

                for (const disciplinaCasada of disciplinasCasadas) {
                    const isCompleted = disciplinaCasada.status === 'APR' || disciplinaCasada.status === 'CUMP';
                    const isInProgress = disciplinaCasada.status === 'MATR';
                    const isElective = disciplinaCasada.tipo === 'optativa';

                    logger.debug(`Classifying discipline: "${disciplinaCasada.nome}" (Status: ${disciplinaCasada.status}, Type: ${disciplinaCasada.tipo}, ID: ${disciplinaCasada.id_materia})`);
                    logger.debug(`  - isCompleted: ${isCompleted}, isInProgress: ${isInProgress}, isElective: ${isElective}`);

                    if (isElective) {
                        electivesCount++;
                    } else {
                        mandatoryCount++;
                    }

                    if (isCompleted) {
                        completedCount++;
                        const completedSubject = { ...disciplinaCasada, status_fluxograma: 'concluida' };
                        if (isElective) {
                            materiasOptativasConcluidas.push(completedSubject);
                            logger.debug(`✓ Elective completed: "${disciplinaCasada.nome}" (${disciplinaCasada.codigo}) - Added to materiasOptativasConcluidas`);
                        } else {
                            materiasConcluidas.push(completedSubject);
                            logger.debug(`✓ Mandatory completed: "${disciplinaCasada.nome}" (${disciplinaCasada.codigo}) - Added to materiasConcluidas`);
                        }
                    } else if (isInProgress) {
                        inProgressCount++;
                        const inProgressSubject = { ...disciplinaCasada, status_fluxograma: 'em_andamento' };
                        if (isElective) {
                            materiasOptativasPendentes.push(inProgressSubject);
                            logger.debug(`⏳ Elective in progress: "${disciplinaCasada.nome}" (${disciplinaCasada.codigo}) - Added to materiasOptativasPendentes`);
                        } else {
                            materiasPendentes.push(inProgressSubject);
                            logger.debug(`⏳ Mandatory in progress: "${disciplinaCasada.nome}" (${disciplinaCasada.codigo}) - Added to materiasPendentes`);
                        }
                    } else {
                        pendingCount++;
                        const pendingSubject = { ...disciplinaCasada, status_fluxograma: 'pendente' };
                        if (isElective) {
                            materiasOptativasPendentes.push(pendingSubject);
                            logger.debug(`⏸️ Elective pending: "${disciplinaCasada.nome}" (${disciplinaCasada.codigo}) - Added to materiasOptativasPendentes`);
                        } else {
                            materiasPendentes.push(pendingSubject);
                            logger.debug(`⏸️ Mandatory pending: "${disciplinaCasada.nome}" (${disciplinaCasada.codigo}) - Added to materiasPendentes`);
                        }
                    }
                }

                logger.info(`Classification completed - Completed: ${completedCount}, In Progress: ${inProgressCount}, Pending: ${pendingCount}`);
                logger.info(`Subject types - Mandatory: ${mandatoryCount}, Electives: ${electivesCount}`)

                // FIND MANDATORY SUBJECTS NOT IN TRANSCRIPT
                logger.info(`Finding mandatory subjects not in transcript (${materiasObrigatorias.length} mandatory subjects total)`);
                const materiasObrigatoriasNaoEncontradas = materiasObrigatorias.filter((materiaBanco: any) => {
                    return !disciplinasCasadas.some((disc: any) => disc.id_materia === materiaBanco.id_materia);
                }).map((materiaBanco: any) => ({
                    id_materia: materiaBanco.id_materia,
                    nome: materiaBanco.materias.nome_materia,
                    codigo: materiaBanco.materias.codigo_materia,
                    nivel: materiaBanco.nivel,
                    encontrada_no_banco: true,
                    encontrada_no_historico: false,
                    tipo: 'obrigatoria',
                    status_fluxograma: 'nao_cursada'
                }));

                logger.info(`Found ${materiasObrigatoriasNaoEncontradas.length} mandatory subjects not in transcript`);

                // PROCESS EQUIVALENCIES FOR MISSING MANDATORY SUBJECTS
                logger.info(`Processing equivalencies for ${materiasObrigatoriasNaoEncontradas.length} missing mandatory subjects`);
                const materiasConcluidasPorEquivalencia: any[] = [];
                const materiasPendentesFinais: any[] = [];
                let equivalenciesProcessed = 0;
                let equivalenciesFound = 0;

                for (const materiaObrigatoria of materiasObrigatoriasNaoEncontradas) {
                    equivalenciesProcessed++;
                    const equivalenciasParaMateria = allEquivalencies?.filter(eq =>
                        eq.id_materia === materiaObrigatoria.id_materia
                    ) || [];

                    logger.debug(`Processing equivalencies for mandatory subject "${materiaObrigatoria.nome}" (${materiaObrigatoria.codigo}) - Found ${equivalenciasParaMateria.length} equivalencies`);

                    const cumpridaPorEquivalencia = checkEquivalencies(
                        disciplinasCasadas,
                        equivalenciasParaMateria,
                        materiaObrigatoria,
                        logger
                    );

                    if (cumpridaPorEquivalencia) {
                        equivalenciesFound++;
                        // Encontrar a disciplina do histórico usada como equivalência
                        let encontrada = null;
                        for (const eq of equivalenciasParaMateria) {
                            const codigosEquivalentes = extractSubjectCodes(eq.expressao);
                            encontrada = disciplinasCasadas.find(
                                d => codigosEquivalentes.includes(d.codigo) && (d.status === 'APR' || d.status === 'CUMP')
                            );
                            if (encontrada) break;
                        }
                        materiasConcluidasPorEquivalencia.push({
                            ...materiaObrigatoria,
                            status_fluxograma: 'concluida_equivalencia',
                            codigo_equivalente: encontrada ? encontrada.codigo : undefined,
                            nome_equivalente: encontrada ? encontrada.nome : undefined
                        });
                        logger.info(`✓ Mandatory subject "${materiaObrigatoria.nome}" completed by equivalency with "${encontrada?.nome}" (${encontrada?.codigo})`);
                    } else {
                        materiasPendentesFinais.push(materiaObrigatoria);
                        logger.debug(`✗ Mandatory subject "${materiaObrigatoria.nome}" remains pending - no equivalency found`);
                    }
                }

                logger.info(`Equivalencies processing completed - Processed: ${equivalenciesProcessed}, Found: ${equivalenciesFound}`)

                // PROCESS ELECTIVES THAT MIGHT BE EQUIVALENCIES FOR MANDATORY SUBJECTS
                const optativasParaProcessar = [...materiasOptativasConcluidas, ...materiasOptativasPendentes];
                logger.info(`Processing ${optativasParaProcessar.length} electives that might be equivalencies for mandatory subjects`);
                const optativasRestantes: any[] = [];
                let electivesProcessed = 0;
                let electivesMarkedAsEquivalency = 0;

                for (const disciplinaOptativa of optativasParaProcessar) {
                    electivesProcessed++;
                    let marcadaComoEquivalencia = false;

                    if (allEquivalencies) {
                        logger.debug(`Processing elective "${disciplinaOptativa.nome}" (${disciplinaOptativa.codigo}) for equivalency potential`);
                        for (const eq of allEquivalencies) {
                            if (!eq.expressao || !eq.expressao.toUpperCase().includes(disciplinaOptativa.codigo)) continue;

                            const obrigatoria = materiasPendentesFinais.find((m: any) => m.id_materia === eq.id_materia);
                            if (!obrigatoria) continue;

                            const codigosEquivalentes = extractSubjectCodes(eq.expressao);
                            const encontrada = disciplinasCasadas.find(
                                d => codigosEquivalentes.includes(d.codigo) && (d.status === 'APR' || d.status === 'CUMP')
                            );

                            if (encontrada) {
                                electivesMarkedAsEquivalency++;
                                materiasConcluidasPorEquivalencia.push({
                                    ...obrigatoria,
                                    status_fluxograma: 'concluida_equivalencia',
                                    equivalencia: disciplinaOptativa.nome,
                                    codigo_equivalente: disciplinaOptativa.codigo,
                                    nome_equivalente: disciplinaOptativa.nome
                                });
                                logger.info(`✓ Elective "${disciplinaOptativa.nome}" marked as equivalency for mandatory "${obrigatoria.nome}"`);
                                marcadaComoEquivalencia = true;
                                break;
                            }
                        }
                    }

                    if (!marcadaComoEquivalencia) {
                        optativasRestantes.push(disciplinaOptativa);
                        logger.debug(`✗ Elective "${disciplinaOptativa.nome}" remains as regular elective`);
                    }
                }

                logger.info(`Electives processing completed - Processed: ${electivesProcessed}, Marked as equivalency: ${electivesMarkedAsEquivalency}, Remaining electives: ${optativasRestantes.length}`)

                // FINAL CALCULATIONS
                logger.info("Starting final calculations and summary");
                const todasMateriasPendentes = [...materiasPendentes, ...materiasPendentesFinais];
                const todasMateriasConcluidas = [...materiasConcluidas, ...materiasConcluidasPorEquivalencia];
                const todasMateriasOptativas = optativasRestantes;

                logger.info(`Final arrays consolidated:`);
                logger.info(`- Pending mandatory: ${todasMateriasPendentes.length}`);
                logger.info(`- Completed mandatory: ${todasMateriasConcluidas.length}`);
                logger.info(`- Remaining electives: ${todasMateriasOptativas.length}`);

                // Log detailed contents of each array
                logger.debug("=== DETAILED FINAL ARRAYS ===");
                logger.debug(`Pending mandatory subjects (${todasMateriasPendentes.length}):`);
                todasMateriasPendentes.forEach((materia, index) => {
                    logger.debug(`  ${index + 1}. "${materia.nome}" (${materia.codigo}) - Status: ${materia.status || 'N/A'}, FluxoStatus: ${materia.status_fluxograma || 'N/A'}`);
                });

                logger.debug(`Completed mandatory subjects (${todasMateriasConcluidas.length}):`);
                todasMateriasConcluidas.forEach((materia, index) => {
                    logger.debug(`  ${index + 1}. "${materia.nome}" (${materia.codigo}) - Status: ${materia.status || 'N/A'}, FluxoStatus: ${materia.status_fluxograma || 'N/A'}`);
                });

                logger.debug(`Remaining electives (${todasMateriasOptativas.length}):`);
                todasMateriasOptativas.forEach((materia, index) => {
                    logger.debug(`  ${index + 1}. "${materia.nome}" (${materia.codigo}) - Status: ${materia.status || 'N/A'}, FluxoStatus: ${materia.status_fluxograma || 'N/A'}`);
                });
                logger.debug("=== END DETAILED ARRAYS ===");

                // Calculate integrated hours
                let horasIntegralizadas = 0;
                let disciplinasComCargaHoraria = 0;
                for (const disciplina of disciplinasCasadas) {
                    if ((disciplina.status === 'APR' || disciplina.status === 'CUMP') && disciplina.carga_horaria) {
                        horasIntegralizadas += disciplina.carga_horaria;
                        disciplinasComCargaHoraria++;
                    }
                }
                dadosValidacao.horas_integralizadas = horasIntegralizadas;

                logger.info(`Hours calculation: ${horasIntegralizadas} hours from ${disciplinasComCargaHoraria} disciplines`);

                // Final summary
                const completionPercentage = (todasMateriasConcluidas.length / (todasMateriasConcluidas.length + todasMateriasPendentes.length) * 100);
                logger.info("=== PROCESSING SUMMARY ===");
                logger.info(`Total disciplines processed: ${disciplinasCasadas.length}`);
                logger.info(`Completed mandatory: ${todasMateriasConcluidas.length}`);
                logger.info(`Pending mandatory: ${todasMateriasPendentes.length}`);
                logger.info(`Electives: ${todasMateriasOptativas.length}`);
                logger.info(`Completion percentage: ${completionPercentage.toFixed(2)}%`);
                logger.info(`Integrated hours: ${horasIntegralizadas}`);
                logger.info(`IRA: ${dadosValidacao.ira || 'Not available'}`);
                logger.info(`Weighted average: ${dadosValidacao.media_ponderada || 'Not available'}`);
                logger.info(`General frequency: ${dadosValidacao.frequencia_geral || 'Not available'}`);
                logger.info("=== END SUMMARY ===");

                const endTime = Date.now();
                const processingTime = endTime - startTime;
                logger.info(`=== DISCIPLINE MATCHING COMPLETED ===`);
                logger.info(`Total processing time: ${processingTime}ms (${(processingTime / 1000).toFixed(2)}s)`);

                return res.status(200).json({
                    disciplinas_casadas: disciplinasCasadas,
                    materias_concluidas: todasMateriasConcluidas,
                    materias_pendentes: todasMateriasPendentes,
                    materias_optativas: todasMateriasOptativas,
                    dados_validacao: dadosValidacao,
                    curso_extraido: curso_extraido,
                    matriz_curricular: matriz_curricular,
                    resumo: {
                        total_disciplinas: disciplinasCasadas.length,
                        total_obrigatorias_concluidas: todasMateriasConcluidas.length,
                        total_obrigatorias_pendentes: todasMateriasPendentes.length,
                        total_optativas: todasMateriasOptativas.length,
                        percentual_conclusao_obrigatorias: todasMateriasConcluidas.length / (todasMateriasConcluidas.length + todasMateriasPendentes.length) * 100
                    }
                });

            } catch (error: any) {
                const endTime = Date.now();
                const processingTime = endTime - startTime;
                logger.error(`Erro ao casar disciplinas: ${error.message}`);
                logger.error(`Error occurred after ${processingTime}ms of processing`);
                return res.status(500).json({ error: error.message || "Erro ao casar disciplinas" });
            }
        }),

        "upload-dados-fluxograma": new Pair(RequestType.POST, async (req: Request, res: Response) => {
            var log = createControllerLogger("FluxogramaController", "upload-dados-fluxograma");
            log.info("Upload fluxograma chamado");
            try {
                if (!await Utils.checkAuthorization(req as Request)) {
                    return res.status(401).json({ error: "Usuário não autorizado" });
                }

                var userId = req.headers["user-id"] || req.headers["User-ID"];

                const { fluxograma, periodo_letivo } = req.body;

                log.info(`Periodo letivo: ${periodo_letivo}`);
                log.info(`User ID: ${userId}`);

                const { data, error } = await SupabaseWrapper.get()
                    .from("dados_users")
                    .insert({
                        fluxograma_atual: fluxograma,
                        id_user: userId,
                        semestre_atual: periodo_letivo
                    }).select("*");
                if (error) throw error;
                return res.status(200).json(data);
            } catch (error: any) {
                log.error(`Erro ao salvar fluxograma: ${error.message}`);
                return res.status(500).json({ error: error.message || "Erro ao salvar fluxograma" });
            }
        }),
        // --- NOVO ENDPOINT DELETE ---
        "delete-fluxograma": new Pair(RequestType.DELETE, async (req: Request, res: Response) => {
            const log = createControllerLogger("FluxogramaController", "delete-fluxograma");
            log.info("Remoção de fluxograma chamada");
            try {
                if (!await Utils.checkAuthorization(req as Request)) {
                    return res.status(401).json({ error: "Usuário não autorizado" });
                }
                var userId = req.headers["user-id"] || req.headers["User-ID"];
                if (!userId) {
                    return res.status(400).json({ error: "User ID não informado" });
                }
                // Remove o registro do usuário (ou zera o campo fluxograma_atual)
                const { error } = await SupabaseWrapper.get()
                    .from("dados_users")
                    .delete()
                    .eq("id_user", userId);
                if (error) throw error;
                return res.status(200).json({ success: true });
            } catch (error: any) {
                log.error(`Erro ao remover fluxograma: ${error.message}`);
                return res.status(500).json({ error: error.message || "Erro ao remover fluxograma" });
            }
        })
    }
}