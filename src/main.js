import { Engine } from './core/Engine.js';
import { LoadingIndicator } from './ui/LoadingIndicator.js';
import { OverlayUI } from './ui/OverlayUI.js';
import { POICard } from './ui/POICard.js';
import { PRESET_MODELS, DEFAULT_MODEL_KEY, getNextPresetKey } from './data/modelPresets.js';

window.addEventListener('DOMContentLoaded', async () => {
  const loadingIndicator = new LoadingIndicator();
  loadingIndicator.show('3DGS WebXR 엔진 초기화 중...');

  const poiCard = new POICard();
  let overlayUI = null;

  let currentPresetKey = DEFAULT_MODEL_KEY;

  const selectModel = async (presetKey) => {
    currentPresetKey = presetKey;
    if (overlayUI?.modelSelect) {
      overlayUI.modelSelect.value = presetKey;
    }
    const preset = PRESET_MODELS[presetKey];
    if (preset) {
      poiCard.hide();
      loadingIndicator.show(`'${presetKey}' 씬을 불러오는 중...`);
      try {
        await engine.loadPreset(presetKey, preset);
      } catch (e) {
        console.error('프리셋 로드 실패:', e);
      }
    }
  };

  // 엔진 초기화
  const engine = new Engine({
    vrButtonContainer: document.getElementById('vr-button-container'),
    onProgress: (percent, statusText) => {
      loadingIndicator.updateProgress(percent, statusText);
    },
    onSceneLoaded: (sceneData) => {
      if (overlayUI) {
        overlayUI.updateSceneInfo(sceneData);
      }
      setTimeout(() => {
        loadingIndicator.hide();
      }, 400);
    },
    onVRStateChanged: (isActive) => {
      if (overlayUI) {
        overlayUI.setVRActive(isActive);
      }
      if (isActive) {
        console.log('WebXR 세션 활성화: Meta Quest / HMD 입체 렌더링 가동');
      } else {
        console.log('WebXR 세션 종료: 데스크톱 뷰어 복귀');
      }
    },
    onPOISelected: (poiData) => {
      poiCard.show(poiData);
    },
    onModelToggle: () => {
      const nextKey = getNextPresetKey(currentPresetKey);
      if (nextKey) {
        selectModel(nextKey);
      }
    },
    onFrameStats: (stats) => {
      if (overlayUI) {
        overlayUI.updateRenderFrameStats(stats);
      }
    }
  });

  // UI 오버레이 초기화
  overlayUI = new OverlayUI({
    presets: PRESET_MODELS,
    initialPresetKey: currentPresetKey,
    onModelSelect: async (presetKey) => {
      await selectModel(presetKey);
    },
    onFileLoad: async (file) => {
      poiCard.hide();
      loadingIndicator.show(`로컬 파일 '${file.name}' 파싱 중...`);
      try {
        await engine.loadCustomFile(file);
      } catch (e) {
        console.error('로컬 파일 로드 실패:', e);
      }
    },
    onResetView: () => {
      engine.resetView();
    },
    onGpuProfileChange: async (profileKey) => {
      loadingIndicator.show(`GPU 메모리 프로필(${profileKey}) 적용하여 씬 재구성 중...`);
      try {
        await engine.setGpuMemoryProfile(profileKey);
      } catch (e) {
        console.error('GPU 메모리 프로필 전환 실패:', e);
      } finally {
        loadingIndicator.hide();
      }
    },
    onSplatScaleChange: (scale) => {
      engine.setSplatScale(scale);
    },
    onAlphaCutoffChange: async (cutoff) => {
      loadingIndicator.show(`알파 임계값 (${cutoff}) 반영하여 씬 재구성 중...`);
      await engine.setAlphaThreshold(cutoff);
      loadingIndicator.hide();
    },
    onPointCloudToggle: (enabled) => {
      engine.setPointCloudMode(enabled);
    }
  });

  // 초기 기본 씬 로드
  try {
    const initialPreset = PRESET_MODELS[DEFAULT_MODEL_KEY];
    if (initialPreset) {
      await engine.loadModel(initialPreset.path, {
        position: initialPreset.position,
        rotation: initialPreset.rotation,
        scale: initialPreset.scale,
        cameraPosition: initialPreset.cameraPosition,
        cameraLookAt: initialPreset.cameraLookAt,
        cameraUp: initialPreset.cameraUp
      });
    }
  } catch (err) {
    console.error('초기 씬 로드 오류:', err);
    loadingIndicator.updateProgress(100, '초기 씬 로드에 실패했습니다. 파일을 직접 열어주세요.');
  }
});
