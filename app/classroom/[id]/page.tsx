'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/store/settings';
import { claimStageSceneLoadToken, isCurrentStageSceneLoadToken } from '@/lib/store/stage';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSceneGenerator } from '@/lib/hooks/use-scene-generator';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  getHistoricalAveragePageDuration,
  recordPageGenerationDuration,
  type GenerationTimingSignature,
} from '@/lib/generation/generation-timing';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import {
  applyClassroomStageAndScenes,
  defaultClassroomLoadDeps,
  runClassroomLoad,
} from '@/lib/classroom/load-classroom';

const log = createLogger('Classroom');

export default function ClassroomDetailPage() {
  const params = useParams();
  const classroomId = params?.id as string;
  const { t } = useI18n();

  const { loadFromStorage } = useStageStore();
  const classroomScenes = useStageStore((s) => s.scenes);
  const classroomOutlines = useStageStore((s) => s.outlines);
  const classroomGenerationComplete = useStageStore((s) => s.generationComplete);
  const classroomGenerationStatus = useStageStore((s) => s.generationStatus);
  const classroomGenerationPhase = useStageStore((s) => s.currentGeneratingPhase);
  const classroomGenerationTitle = useStageStore((s) => s.currentGeneratingTitle);
  const classroomGeneratingOrder = useStageStore((s) => s.currentGeneratingOrder);
  const classroomGenerationStartedAt = useStageStore((s) => s.generationStartedAt);
  const timingSignature: GenerationTimingSignature = (() => {
    const model = getCurrentModelConfig();
    const settings = useSettingsStore.getState();
    const ttsConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
    return {
      llmModel: model.modelString,
      ttsProvider: settings.ttsEnabled ? settings.ttsProviderId : 'disabled',
      ttsModel: settings.ttsEnabled
        ? ttsConfig?.modelId || settings.ttsModel || 'default'
        : 'disabled',
    };
  })();
  const [progressNow, setProgressNow] = useState(() => Date.now());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationStartedRef = useRef(false);
  const generationBaselineScenesRef = useRef<number | null>(null);
  const generationRunStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (classroomGenerationStatus !== 'generating') return;
    const timer = window.setInterval(() => setProgressNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [classroomGenerationStatus]);

  useEffect(() => {
    if (classroomGenerationStatus === 'generating') {
      if (generationBaselineScenesRef.current === null) {
        generationBaselineScenesRef.current = classroomScenes.length;
        generationRunStartedAtRef.current = Date.now();
      }
    } else {
      generationBaselineScenesRef.current = null;
      generationRunStartedAtRef.current = null;
    }
  }, [classroomGenerationStatus, classroomScenes.length]);

  const { generateRemaining, retrySingleOutline, stop } = useSceneGenerator({
    onComplete: () => {
      log.info('[Classroom] All scenes generated');
    },
    onSceneGeneratedWithDuration: (_scene, _order, durationMs) => {
      recordPageGenerationDuration(durationMs, timingSignature);
    },
  });

  const loadClassroom = useCallback(
    async (isEffectCurrent: () => boolean = () => true) => {
      const loadToken = claimStageSceneLoadToken();
      const isCurrent = () => isEffectCurrent() && isCurrentStageSceneLoadToken(loadToken);

      await runClassroomLoad({
        classroomId,
        loadToken,
        isCurrent,
        loadFromStorage,
        getCurrentStage: () => useStageStore.getState().stage,
        fetchClassroom: defaultClassroomLoadDeps.fetchClassroom,
        applyFallbackScenes: (args) =>
          defaultClassroomLoadDeps.applyFallbackScenes({
            ...args,
            isCurrent,
            applyStageAndScenes: applyClassroomStageAndScenes,
          }),
        loadRestoredMediaTasks: defaultClassroomLoadDeps.loadRestoredMediaTasks,
        applyRestoredMediaTasks: defaultClassroomLoadDeps.applyRestoredMediaTasks,
        discardRestoredMediaTasks: defaultClassroomLoadDeps.discardRestoredMediaTasks,
        loadLegacyAgentFallbacks: defaultClassroomLoadDeps.loadLegacyAgentFallbacks,
        commitMigratedAgentConfigs: defaultClassroomLoadDeps.commitMigratedAgentConfigs,
        applyGeneratedAgents: defaultClassroomLoadDeps.applyGeneratedAgents,
        getSettings: () => useSettingsStore.getState(),
        getAgent: (id) => useAgentRegistry.getState().getAgent(id),
        restoreAgentSelection: defaultClassroomLoadDeps.restoreAgentSelection,
        setError,
        setLoading,
        log,
      });
    },
    [classroomId, loadFromStorage],
  );

  useEffect(() => {
    // Reset loading state on course switch to unmount Stage during transition,
    // preventing stale data from syncing back to the new course
    /* eslint-disable react-hooks/set-state-in-effect -- Course switch must hide stale Stage before async load */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    generationStartedRef.current = false;

    // Clear previous classroom's media tasks to prevent cross-classroom contamination.
    // Placeholder IDs (gen_img_1, gen_vid_1) are NOT globally unique across stages,
    // so stale tasks from a previous classroom would shadow the new one's.
    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    // Clear whiteboard history to prevent snapshots from a previous course leaking in.
    useWhiteboardHistoryStore.getState().clearHistory();

    let cancelled = false;
    loadClassroom(() => !cancelled);

    // Cancel ongoing generation when classroomId changes or component unmounts
    return () => {
      cancelled = true;
      stop();
    };
  }, [classroomId, loadClassroom, stop]);

  // Auto-resume generation for pending outlines
  useEffect(() => {
    if (loading || error || generationStartedRef.current) return;

    const state = useStageStore.getState();
    const { outlines, scenes, stage, generationComplete } = state;

    // Check if there are pending outlines. A finished deck is frozen for
    // editing: deleting a slide leaves its outline orphaned, but that must not
    // be treated as an interrupted generation and regenerated. Only resume
    // when generation has not completed.
    const completedOrders = new Set(scenes.map((s) => s.order));
    const hasPending = !generationComplete && outlines.some((o) => !completedOrders.has(o.order));

    if (hasPending && stage) {
      generationStartedRef.current = true;

      // Load generation params from sessionStorage (stored by generation-preview before navigating)
      const genParamsStr = sessionStorage.getItem('generationParams');
      const params = genParamsStr ? JSON.parse(genParamsStr) : {};

      // Reconstruct imageMapping from IndexedDB using pdfImages storageIds
      const storageIds = (params.pdfImages || [])
        .map((img: { storageId?: string }) => img.storageId)
        .filter(Boolean);

      loadImageMapping(storageIds).then((imageMapping) => {
        generateRemaining({
          pdfImages: params.pdfImages,
          imageMapping,
          stageInfo: {
            name: stage.name || '',
            description: stage.description,
            style: stage.style,
          },
          agents: params.agents,
          userProfile: params.userProfile,
          languageDirective: params.languageDirective || stage.languageDirective,
        });
      });
    } else if (outlines.length > 0 && stage) {
      // All scenes are generated, but some media may not have finished.
      // Resume media generation for any tasks not yet in IndexedDB.
      // generateMediaForOutlines skips already-completed tasks automatically.
      generationStartedRef.current = true;
      // The deck reached the classroom already fully materialized (e.g. a
      // single-slide course, or a deck whose last slide finished in
      // generation-preview), so generateRemaining's completion path never
      // ran. Record completion now so a later edit/delete is not treated as
      // an interrupted generation. No-op if already complete or not all
      // outlines have scenes.
      useStageStore.getState().markGenerationCompleteIfDone();
      // Resume media only for outlines that still have a scene. On a finished
      // deck the user may have deleted a slide, leaving an orphaned outline;
      // generating its media would waste API calls on a slide that is gone.
      const materializedOrders = new Set(scenes.map((s) => s.order));
      const materializedOutlines = outlines.filter((o) => materializedOrders.has(o.order));
      generateMediaForOutlines(materializedOutlines, stage.id).catch((err) => {
        log.warn('[Classroom] Media generation resume error:', err);
      });
    }
  }, [loading, error, generateRemaining]);

  const pendingSceneCount = classroomOutlines.filter(
    (outline) => !classroomScenes.some((scene) => scene.order === outline.order),
  ).length;
  const isCourseStillGenerating =
    !loading &&
    !error &&
    !classroomGenerationComplete &&
    pendingSceneCount > 0 &&
    classroomGenerationStatus === 'generating';
  const completedSceneCount = classroomOutlines.length - pendingSceneCount;
  const phaseProgress =
    classroomGenerationPhase === 'content'
      ? 0.35
      : classroomGenerationPhase === 'actions'
        ? 0.68
        : classroomGenerationPhase === 'tts'
          ? 0.9
          : 0;
  const generatedPercent = classroomOutlines.length
    ? Math.min(
        99,
        Math.round(((completedSceneCount + phaseProgress) / classroomOutlines.length) * 100),
      )
    : 0;
  const completedDuringRun = Math.max(
    0,
    classroomScenes.length - (generationBaselineScenesRef.current ?? classroomScenes.length),
  );
  const elapsedMs = generationRunStartedAtRef.current || classroomGenerationStartedAt
    ? Math.max(
        0,
        progressNow - (generationRunStartedAtRef.current || classroomGenerationStartedAt || progressNow),
      )
    : 0;
  const etaMs = completedDuringRun > 0
    ? Math.max(0, (elapsedMs / completedDuringRun) * pendingSceneCount)
    : (getHistoricalAveragePageDuration(timingSignature) ?? 0) * pendingSceneCount;
  const etaUsesHistory = completedDuringRun < 2 && etaMs > 0;
  const formatDuration = (ms: number) =>
    `${Math.floor(ms / 60000)}m ${Math.floor(ms / 1000) % 60}s`;

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-screen flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center text-muted-foreground">
                <p>Loading classroom...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <p className="text-destructive mb-4">Error: {error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    loadClassroom();
                  }}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <>
              <Stage onRetryOutline={retrySingleOutline} />
              {isCourseStillGenerating && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
                  <div className="w-full max-w-xl rounded-xl border bg-card p-6 text-center shadow-xl">
                    <Loader2 className="mx-auto mb-3 size-8 animate-spin text-primary" />
                    <h2 className="text-lg font-semibold">{t('generation.courseGeneratingTitle')}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {classroomGenerationPhase === 'content'
                        ? t('generation.phaseContent')
                        : classroomGenerationPhase === 'actions'
                          ? t('generation.phaseActions')
                          : classroomGenerationPhase === 'tts'
                            ? t('generation.phaseTts')
                            : t('generation.phasePreparing')}
                      {classroomGenerationTitle ? ` · ${classroomGenerationTitle}` : ''}
                    </p>
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-500"
                        style={{ width: `${generatedPercent}%` }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {generatedPercent}% · {t('generation.completedPages', {
                          completed: classroomScenes.length,
                          total: classroomOutlines.length,
                        })}
                        {classroomGeneratingOrder > 0 &&
                          ` · ${t('generation.currentPage', {
                            page: classroomGeneratingOrder,
                            total: classroomOutlines.length,
                          })}`}
                      </span>
                      <span>
                        {t('generation.elapsedTime', { duration: formatDuration(elapsedMs) })}
                        {etaMs > 0 &&
                          ` · ${t(etaUsesHistory ? 'generation.etaHistorical' : 'generation.etaTime', {
                            duration: formatDuration(etaMs),
                          })}`}
                      </span>
                    </div>
                    <p className="mt-4 text-xs text-muted-foreground">
                      {t('generation.autoContinueHint')}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
