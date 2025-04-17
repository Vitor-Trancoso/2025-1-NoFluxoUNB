# 📋 Levantamento de Requisitos

## ✅ Requisitos Funcionais

- O sistema deve permitir que o usuário faça login e salve suas simulações.  
- O sistema deve permitir upload do histórico em PDF.  
- O sistema deve ler o PDF e identificar as disciplinas cursadas, aprovadas e reprovadas.  
- O sistema deve consultar um banco de dados com o fluxograma do curso e equivalências.  
- O sistema deve mostrar o fluxograma do curso do usuário com:
  - Disciplinas cursadas destacadas.
  - Equivalências ao passar o mouse/clicar.
  - Número de vezes que cursou/reprovou.
- O sistema deve calcular e exibir a porcentagem de conclusão do curso.  
- O sistema deve calcular e exibir o IRA (Índice de Rendimento Acadêmico) e a média ponderada do aluno.  
- O sistema deve identificar e exibir a quantidade de horas complementares já cumpridas e as pendentes.  
- O sistema deve permitir que o usuário informe horários não disponíveis.  
- O sistema deve gerar automaticamente uma grade horária possível com base nas matérias disponíveis e nos horários livres.  
- O sistema deve gerar um PDF da simulação da nova grade.  
- O sistema deve permitir ver trocas de curso e o quanto de aproveitamento seria possível.  
- O sistema deve armazenar os dados do usuário e simulações anteriores (se logado).  
- O sistema deve permitir visualizar o número de semestres cursados e os restantes com base no tempo máximo do curso.  
- O sistema deve permitir a simulação de grade de acordo com metas (ex: formar em X semestres).  
- O sistema deve permitir que o usuário selecione preferências de grade (evitar manhãs, concentrar em poucos dias, etc).  
- O sistema deve identificar e exibir, com base no histórico:
  - Se o aluno já trancou algum período.
  - Quantas vezes trancou o curso.
  - O(s) semestre(s) do(s) trancamento(s).
- O sistema deve identificar e exibir, com base no histórico:
  - Se o aluno trocou de curso.
  - Qual era o curso anterior.
  - Quando a mudança ocorreu.
  - Quais disciplinas foram aproveitadas.  
- O sistema deve ter um agente de inteligência artificial que auxilie o aluno a escolher cursos e disciplinas com base em sua área de interesse, histórico e preferências pessoais.
- Notas e comentários pessoais
      Permitir ao aluno fazer anotações em disciplinas ou simulações (ex: "Evitar professor X", "Não gostei da matéria").
- Alertas de pré-requisitos e disciplinas críticas
      Exibir alertas se o aluno estiver deixando de cursar uma disciplina que é pré-requisito para muitas outras (efeito dominó).
  

---

## ⚙️ Requisitos Não Funcionais

### Responsividade
- O sistema deve ser responsivo e funcionar bem em dispositivos móveis e desktop.

### Tempo de resposta
- O sistema deve ter tempo de resposta inferior a 2 segundos para ações principais:
  - Geração de simulação de grade  
  - Exibição do fluxograma  
  - Upload e leitura de histórico

### Segurança de dados
- Autenticação segura para usuários logados.  
- Dados pessoais e acadêmicos armazenados de forma criptografada.

### Precisão na leitura do histórico
- O sistema deve garantir acurácia mínima de 95% na extração de dados dos históricos em PDF.

### Escalabilidade
- Deve ser capaz de suportar grande número de acessos simultâneos, especialmente durante períodos de matrícula.

### Compatibilidade de navegador
- Compatível com:
  - Google Chrome  
  - Mozilla Firefox  
  - Microsoft Edge  
  - Safari (opcional)

### Usabilidade
- Interface intuitiva, visual e de fácil uso, com foco em clareza e organização.

### Padrão visual do PDF exportado
- PDF gerado deve ter layout limpo e padronizado com identidade visual do projeto.

### Disponibilidade
- O sistema deve estar disponível 24/7 com até 0,5% de indisponibilidade mensal.

### Performance do parser de PDF
- A leitura deve ser concluída em até 5 segundos para arquivos com até 10 páginas.

### Acessibilidade
- O sistema deve seguir práticas básicas de acessibilidade:
  - Contraste adequado  
  - Navegação por teclado  
  - Textos alternativos
