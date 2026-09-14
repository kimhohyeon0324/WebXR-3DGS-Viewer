import { Engine } from './core/Engine.js';
import { LoadingIndicator } from './ui/LoadingIndicator.js';
import { OverlayUI } from './ui/OverlayUI.js';
import { POICard } from './ui/POICard.js';

// 프리셋 모델 경로 및 바운딩 박스 정밀 정합된 최적 카메라 시점 매핑
const PRESET_MODELS = {
  bonsai: {
    path: '/models/bonsai_trimmed.ksplat',
    // 테이블 상판 및 나무 받침대(11.17° 미세 잔여 경사)를 추가 교정하여 지면과 100% 수평 정합한 쿼터니언
    rotation: [0.917140, -0.187314, 0.018722, 0.351307],
    scale: [0.35, 0.35, 0.35],
    // 테이블 기둥 바닥 천 끝자락을 그리드 바닥(y=0.00)에 안착시키고 XZ 중심 정렬
    position: [0.032, 1.926, 0.055],
    cameraPosition: [0.0, 1.35, 2.1],
    cameraLookAt: [0.0, 1.15, 0.0],
    cameraUp: [0.0, 1.0, 0.0]
  },
  dragon: {
    path: '/models/dragon.splat',
    // OpenCV 거꾸로 된 좌표계를 정상 Three.js Y-Up으로 기립시키는 X축 180도 회전
    rotation: [1, 0, 0, 0],
    // 스탠포드 드래곤 받침대를 지면 y=0.00에 완벽하게 안착시키는 position
    position: [0.0, 0.796, 0.0],
    scale: [1.3, 1.3, 1.3],
    cameraPosition: [0.0, 1.1, 2.3],
    cameraLookAt: [0.0, 0.85, 0.0],
    cameraUp: [0, 1, 0]
  }
};

window.addEventListener('DOMContentLoaded', async () => {
  const loadingIndicator = new LoadingIndicator();
  loadingIndicator.show('3DGS WebXR 엔진 초기화 중...');

  const poiCard = new POICard();
  let overlayUI = null;

  let currentPresetKey = 'bonsai';

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
        await engine.loadModel(preset.path, {
          position: preset.position,
          rotation: preset.rotation,
          scale: preset.scale,
          cameraPosition: preset.cameraPosition,
          cameraLookAt: preset.cameraLookAt,
          cameraUp: preset.cameraUp
        });
        // 모델 전환 시 전용 POI 핀으로 교체
        const poiMgr = engine.getPOIManager();
        if (poiMgr) {
          poiMgr.loadPreset(presetKey);
        }

        // WebXR 인터랙션 피벗(시각적 중심) 및 시점 재배치
        engine.setPivotOffset(preset.cameraLookAt || engine.splatManager.getModelCenter());
        engine.recenterXR();
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
      const nextKey = currentPresetKey === 'bonsai' ? 'dragon' : 'bonsai';
      selectModel(nextKey);
    }
  });

  // UI 오버레이 초기화
  overlayUI = new OverlayUI({
    onModelSelect: async (presetKey) => {
      await selectModel(presetKey);
    },
    onFileLoad: async (file) => {
      poiCard.hide();
      loadingIndicator.show(`로컬 파일 '${file.name}' 파싱 중...`);
      try {
        await engine.loadModel(file);
        const poiMgr = engine.getPOIManager();
        if (poiMgr) {
          poiMgr.clearPins();
        }
        engine.setPivotOffset(engine.splatManager.getModelCenter());
        engine.recenterXR();
      } catch (e) {
        console.error('로컬 파일 로드 실패:', e);
      }
    },
    onResetView: () => {
      engine.resetView();
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

  // 초기 기본 씬 로드 (Bonsai Tree 최적 파라미터 적용)
  try {
    const initialPreset = PRESET_MODELS.bonsai;
    await engine.loadModel(initialPreset.path, {
      position: initialPreset.position,
      rotation: initialPreset.rotation,
      scale: initialPreset.scale,
      cameraPosition: initialPreset.cameraPosition,
      cameraLookAt: initialPreset.cameraLookAt,
      cameraUp: initialPreset.cameraUp
    });
  } catch (err) {
    console.error('초기 씬 로드 오류:', err);
    loadingIndicator.updateProgress(100, '초기 씬 로드에 실패했습니다. 파일을 직접 열어주세요.');
  }
});
