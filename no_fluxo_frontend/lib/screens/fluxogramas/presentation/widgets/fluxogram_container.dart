import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/gestures.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:go_router/go_router.dart';
import '../../data/curso_model.dart';
import '../../data/materia_model.dart';
import '../../../../utils/utils.dart';
import 'course_card_widget.dart';
import 'materia_data_dialog_content.dart';
import 'prerequisite_connections_widget.dart';

class FluxogramContainer extends StatefulWidget {
  final CursoModel? courseData;
  final double zoomLevel;
  final bool showConnections;
  final bool isAnonymous;
  final Function(String, String) onShowPrerequisiteChain;
  final Function(BuildContext, MateriaModel) onShowMateriaDialog;
  final GlobalKey? containerKey;
  final GlobalKey? contentKey;
  final Function(ScrollController, ScrollController)? onScrollControllersReady;

  const FluxogramContainer({
    super.key,
    required this.courseData,
    required this.zoomLevel,
    required this.showConnections,
    required this.onShowPrerequisiteChain,
    required this.onShowMateriaDialog,
    this.isAnonymous = false,
    this.containerKey,
    this.contentKey,
    this.onScrollControllersReady,
  });

  @override
  State<FluxogramContainer> createState() => _FluxogramContainerState();
}

class _FluxogramContainerState extends State<FluxogramContainer> {
  String? selectedSubjectCode;
  final ScrollController _scrollController = ScrollController();
  final ScrollController _connectionsScrollController = ScrollController();
  final ScrollController _verticalScrollController = ScrollController();
  final ScrollController _connectionsVerticalScrollController =
      ScrollController();

  @override
  void initState() {
    super.initState();
    _updateScrollControllersInParent();
  }

  @override
  void didUpdateWidget(FluxogramContainer oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Update scroll controllers if showConnections changed
    if (oldWidget.showConnections != widget.showConnections) {
      _updateScrollControllersInParent();
    }
  }

  void _updateScrollControllersInParent() {
    // Pass scroll controllers to parent if callback is provided
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.onScrollControllersReady != null) {
        if (widget.showConnections) {
          widget.onScrollControllersReady!(
            _connectionsScrollController,
            _connectionsVerticalScrollController,
          );
        } else {
          widget.onScrollControllersReady!(
            _scrollController,
            _verticalScrollController,
          );
        }
      }
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _connectionsScrollController.dispose();
    _verticalScrollController.dispose();
    _connectionsVerticalScrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Check if there's fluxogram data to display
    bool hasFluxogramData = false;
    for (final semesterSubjects
        in widget.courseData?.materias ?? List<MateriaModel>.empty()) {
      hasFluxogramData = true;
      break;
    }

    if (!hasFluxogramData) {
      return _buildEmptyState(context);
    }

    if (widget.showConnections) {
      return Container(
        margin: const EdgeInsets.only(bottom: 32),
        child: ScrollConfiguration(
          behavior: ScrollConfiguration.of(context).copyWith(
            scrollbars: false,
            dragDevices: {
              PointerDeviceKind.touch,
              PointerDeviceKind.mouse,
            },
          ),
          child: SingleChildScrollView(
            controller: _connectionsVerticalScrollController,
            scrollDirection: Axis.vertical,
            physics: const BouncingScrollPhysics(),
            child: SingleChildScrollView(
              controller: _connectionsScrollController,
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(),
              child: Center(
                child: Container(
                  key: widget.containerKey,
                  padding:
                      const EdgeInsets.symmetric(vertical: 32, horizontal: 32),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.4),
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Transform.scale(
                    scale: widget.zoomLevel,
                    child: PrerequisiteConnectionsWidget(
                      key: widget.contentKey,
                      courseData: widget.courseData,
                      zoomLevel: widget.zoomLevel,
                      selectedSubjectCode: selectedSubjectCode,
                      isAnonymous: widget.isAnonymous,
                      onSubjectSelectionChanged: (subjectCode) {
                        setState(() {
                          selectedSubjectCode = subjectCode;
                        });
                      },
                      onShowMateriaDialog: widget.onShowMateriaDialog,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: Container(
        margin: const EdgeInsets.only(bottom: 32),
        child: ScrollConfiguration(
          behavior: ScrollConfiguration.of(context).copyWith(
            scrollbars: false,
            dragDevices: {
              PointerDeviceKind.touch,
              PointerDeviceKind.mouse,
            },
          ),
          child: SingleChildScrollView(
            controller: _verticalScrollController,
            scrollDirection: Axis.vertical,
            physics: const BouncingScrollPhysics(),
            child: SingleChildScrollView(
              controller: _scrollController,
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(),
              child: Center(
                child: Container(
                  key: widget.containerKey,
                  padding:
                      const EdgeInsets.symmetric(vertical: 32, horizontal: 32),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.4),
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Transform.scale(
                    scale: widget.zoomLevel,
                    child: Row(
                      key: widget.contentKey,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (int semester = 1;
                            semester <= (widget.courseData?.semestres ?? 0);
                            semester++)
                          _buildSemesterColumn(semester),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 32),
      padding: const EdgeInsets.all(48),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: Colors.white.withOpacity(0.1),
          width: 1,
        ),
      ),
      child: Center(
        child: Column(
          children: [
            Icon(
              Icons.school_outlined,
              size: 64,
              color: Colors.white.withOpacity(0.3),
            ),
            const SizedBox(height: 16),
            Text(
              'Nenhum fluxograma encontrado',
              style: GoogleFonts.poppins(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              widget.isAnonymous
                  ? 'Explore os fluxogramas disponíveis ou faça login para personalizar.'
                  : 'Faça upload do seu histórico acadêmico para visualizar seu fluxograma personalizado.',
              textAlign: TextAlign.center,
              style: GoogleFonts.poppins(
                color: Colors.white.withOpacity(0.7),
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 24),
            if (!widget.isAnonymous)
              ElevatedButton.icon(
                onPressed: () => context.go('/upload-historico'),
                icon: const Icon(Icons.upload_file, color: Colors.white),
                label: Text(
                  'FAZER UPLOAD DO HISTÓRICO',
                  style: GoogleFonts.poppins(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF8B5CF6),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildSemesterColumn(int semester) {
    return Container(
      margin: const EdgeInsets.only(right: 32),
      child: Column(
        children: [
          // Semester Header
          Container(
            margin: const EdgeInsets.only(bottom: 16),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              '${semester}º Semestre',
              style: GoogleFonts.poppins(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
          ),

          // Course Cards
          ..._getCoursesForSemester(semester),
        ],
      ),
    );
  }

  List<Widget> _getCoursesForSemester(int semester) {
    final subjects = widget.courseData?.materias
            .where((materia) => materia.nivel == semester)
            .toList() ??
        [];

    return subjects
        .map((subject) => Builder(
              builder: (context) => GestureDetector(
                onTap: () {
                  widget.onShowMateriaDialog(context, subject);
                },
                onLongPress: !widget.isAnonymous
                    ? () {
                        widget.onShowPrerequisiteChain(
                            subject.codigoMateria, subject.nomeMateria);
                      }
                    : null,
                child: Stack(
                  children: [
                    CourseCardWidget(
                      subject: subject,
                      isAnonymous: widget.isAnonymous,
                      allSubjects: widget.courseData?.materias,
                      onTap: () {
                        widget.onShowMateriaDialog(context, subject);
                      },
                    ),
                  ],
                ),
              ),
            ))
        .toList();
  }
}
