import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { getGpuProfile, DEFAULT_GPU_PROFILE_KEY } from '../data/gpuTuningProfiles.js';

/**
 * 3D Gaussian Splatting 코어 렌더링 및 씬 라이프사이클 관리자
 */
export class SplatManager {
  /**
   * @param {Object} [options]
   * @param {HTMLElement} [options.container] - 캔버스가 마운트될 DOM 컨테이너
   * @param {THREE.Scene} [options.threeScene] - 3DGS와 합성 렌더링할 Three.js 씬
   * @param {string} [options.gpuProfileKey] - 초기 GPU 메모리 튜닝 프로필 키
   * @param {number} [options.alphaThreshold] - 알파 컷오프 임계값
   * @param {Function} [options.onProgress] - 로딩 진행률 콜백 (percent, message)
   * @param {Function} [options.onSceneLoaded] - 씬 로드 완료 콜백 ({ splatCount, format })
   */
  constructor(options = {}) {
    this.container = options.container || document.getElementById('viewer-container');
    this.threeScene = options.threeScene || new THREE.Scene();
    this.onProgress = options.onProgress || (() => {});
    this.onSceneLoaded = options.onSceneLoaded || (() => {});

    this.viewer = null;
    this.currentSceneIndex = null;
    this.currentSource = null;
    this.currentSceneOptions = {};
    this.isLoading = false;
    this.currentLoadPromise = null;
    this.currentAbortController = null;
    this.onXRFrameCallback = null;

    // GPU 메모리 튜닝 프로필 초기화 (기본: BALANCED - FP16 / 16-bit 압축 / 중간버퍼 즉시해제)
    this.currentGpuProfileKey = options.gpuProfileKey || DEFAULT_GPU_PROFILE_KEY;
    this.currentGpuProfile = getGpuProfile(this.currentGpuProfileKey);

    // 현재 렌더 튜닝 파라미터 상태 (선택된 GPU 프로필 기본값 반영)
    this.renderSettings = {
      splatScale: 1.0,
      alphaThreshold: options.alphaThreshold !== undefined
        ? options.alphaThreshold
        : this.currentGpuProfile.sceneOptions.splatAlphaRemovalThreshold,
      pointCloudMode: false,
      focalAdjustment: 1.0
    };

    // 기본 카메라 초기값 (표준 Three.js Y-Up 좌표계 기준)
    this.defaultCameraConfig = {
      cameraUp: [0, 1, 0],
      initialCameraPosition: [0, 1.5, 3.5],
      initialCameraLookAt: [0, 1.2, 0]
    };

    this.initViewer();
  }

  /**
   * GaussianSplats3D.Viewer 초기화 (현재 GPU 프로필 옵션 적용)
   * @param {Object} [customOptions]
   */
  initViewer(customOptions = {}) {
    const profile = this.currentGpuProfile;
    const viewerOpts = { ...profile.viewerOptions, ...(customOptions.viewerOptions || {}) };

    this.viewer = new GaussianSplats3D.Viewer({
      rootElement: this.container,
      threeScene: this.threeScene,
      cameraUp: this.defaultCameraConfig.cameraUp,
      initialCameraPosition: this.defaultCameraConfig.initialCameraPosition,
      initialCameraLookAt: this.defaultCameraConfig.initialCameraLookAt,
      useBuiltInControls: true,
      selfDrivenMode: true,
      gpuAcceleratedSort: false, // 호환성 극대화 (브라우저 GPU 차이 방지)
      sharedMemoryForWorkers: false, // SharedArrayBuffer CORS/보안 이슈 원천 차단
      dynamicScene: false, // 로드 시점에 트랜스폼 베이킹(안정성 극대화)
      sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
      logLevel: GaussianSplats3D.LogLevel.None,
      // 대용량 씬 대비 GPU 메모리 튜닝 파라미터 적용
      halfPrecisionCovariancesOnGPU: viewerOpts.halfPrecisionCovariancesOnGPU,
      inMemoryCompressionLevel: viewerOpts.inMemoryCompressionLevel,
      freeIntermediateSplatData: viewerOpts.freeIntermediateSplatData,
      integerBasedSort: viewerOpts.integerBasedSort,
      sphericalHarmonicsDegree: viewerOpts.sphericalHarmonicsDegree
    });

    // GaussianSplats3D WebXR stereo uniform 계산 시 유효하지 않은 투영 행렬에 대한 안전 가드 래퍼
    if (this.viewer && typeof this.viewer.adjustForWebXRStereo === 'function') {
      const originalAdjust = this.viewer.adjustForWebXRStereo.bind(this.viewer);
      this.viewer.adjustForWebXRStereo = (renderDimensions) => {
        try {
          const xrCamera = this.viewer.renderer?.xr?.getCamera();
          const proj00 = xrCamera?.projectionMatrix?.elements?.[0];
          // 유효한 투영 행렬 값이 준비되었을 때만 원본 계산 실행
          if (Number.isFinite(proj00) && proj00 > 0.0001) {
            originalAdjust(renderDimensions);
          }
        } catch (err) {
          console.warn('[SplatManager] adjustForWebXRStereo guard catch:', err);
        }
      };
    }
  }

  /**
   * WebXR VR 세션 진입 처리
   */
  enterVR(onXRFrame = null) {
    if (!this.viewer) return;

    if (onXRFrame) {
      this.onXRFrameCallback = onXRFrame;
    }

    if (this.viewer.requestFrameId) {
      cancelAnimationFrame(this.viewer.requestFrameId);
      this.viewer.requestFrameId = null;
    }

    this.ensureVRAnimationLoop();
    console.log('SplatManager: WebXR 스테레오 렌더 루프 가동');
  }

  /**
   * WebXR VR 전용 렌더 루프 가동 및 유지 (씬 전환 시 덮어쓰기 방지)
   */
  ensureVRAnimationLoop() {
    if (!this.viewer || !this.viewer.renderer) return;

    this.viewer.webXRActive = true;
    this.viewer.webXRMode = GaussianSplats3D.WebXRMode.VR;
    this.viewer.renderMode = GaussianSplats3D.RenderMode.Always;
    this.viewer.forceRenderNextFrame();

    this.viewer.renderer.setAnimationLoop((time, frame) => {
      try {
        if (typeof this.onXRFrameCallback === 'function') {
          this.onXRFrameCallback(time, frame);
        }
        this.viewer.forceRenderNextFrame();
        this.viewer.selfDrivenUpdate();
      } catch (err) {
        console.error('[WebXR AnimationLoop Error]:', err);
      }
    });
  }

  /**
   * WebXR VR 세션 종료 처리
   */
  exitVR() {
    if (!this.viewer) return;

    if (this.viewer.renderer) {
      this.viewer.renderer.setAnimationLoop(null);
    }

    this.viewer.webXRActive = false;
    this.viewer.webXRMode = GaussianSplats3D.WebXRMode.None;
    this.onXRFrameCallback = null;

    if (this.viewer.selfDrivenMode && this.viewer.selfDrivenUpdateFunc) {
      this.viewer.requestFrameId = requestAnimationFrame(this.viewer.selfDrivenUpdateFunc);
    }

    this.resetCamera();
    console.log('SplatManager: PC 렌더 루프 복귀');
  }

  /**
   * 현재 진행 중인 씬 다운로드 및 WASM 버퍼 파싱 작업을 안전하게 중단(Abort)
   * @param {string} [reason]
   */
  abortCurrentLoad(reason = '사용자에 의해 씬 로드가 취소되었습니다.') {
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort(reason);
      } catch (e) {
        console.warn('[SplatManager] currentAbortController.abort() warning:', e);
      }
      this.currentAbortController = null;
    }

    if (this.currentLoadPromise && typeof this.currentLoadPromise.abort === 'function') {
      try {
        this.currentLoadPromise.abort(reason);
      } catch (e) {
        console.warn('[SplatManager] currentLoadPromise.abort() warning:', e);
      }
      this.currentLoadPromise = null;
    }

    this.isLoading = false;
  }

  /**
   * 씬 로드 (파일 경로 또는 File/Blob 객체) - AbortController 비동기 취소 지원
   */
  async loadScene(source, sceneOptions = {}) {
    if (this.isLoading) {
      console.log('SplatManager: 이전 씬 로드를 중단하고 새 씬으로 전환합니다.');
      this.abortCurrentLoad('새로운 씬 로드 요청');
      await new Promise(resolve => setTimeout(resolve, 35));
    }

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    this.isLoading = true;
    this.currentSource = source;
    this.currentSceneOptions = sceneOptions;
    this.onProgress(0, '3DGS 가우시안 씬 준비 중...');

    try {
      // 새 씬 로드 전 기존 씬 인덱스를 저장 (새 씬이 완전히 로드된 후에만 이전 씬을 안전하게 제거하여 블랙스크린 방지)
      const existingSceneCount = this.viewer?.splatMesh?.scenes?.length || 0;
      const oldSceneIndexes = existingSceneCount > 0
        ? Array.from({ length: existingSceneCount }, (_, i) => i)
        : [];

      let format = null;
      let pathOrFile = source;

      if (source instanceof File) {
        const ext = source.name.split('.').pop().toLowerCase();
        if (ext === 'ply') format = GaussianSplats3D.SceneFormat.Ply;
        else if (ext === 'splat') format = GaussianSplats3D.SceneFormat.Splat;
        else if (ext === 'ksplat') format = GaussianSplats3D.SceneFormat.KSplat;
      }

      /** @type {Record<string, any>} */
      const defaultOptions = {
        splatAlphaRemovalThreshold: this.renderSettings.alphaThreshold,
        showLoadingUI: false,
        progressiveLoad: false,
        position: [0, 1, 0],
        rotation: [0, 0, 0, 1],
        scale: [1.5, 1.5, 1.5],
        format: null,
        onProgress: (percent, percentText, status) => {
          if (abortController.signal.aborted) return;
          let statusLabel = '가우시안 데이터 스트리밍...';
          if (status === 1) statusLabel = '다운로드 중...';
          else if (status === 2) statusLabel = 'GPU/WASM 정렬 버퍼 구축 중...';
          this.onProgress(percent, statusLabel);
        },
        ...sceneOptions
      };

      if (format !== null) {
        defaultOptions.format = format;
      }

      // 새 씬 로드 시도 (AbortablePromise 추적)
      const loadPromise = this.viewer.addSplatScene(pathOrFile, defaultOptions);
      this.currentLoadPromise = loadPromise;
      await loadPromise;

      // 완료 직전 취소 여부 재확인
      if (abortController.signal.aborted) {
        console.log('[SplatManager] 씬 로드 완료 직전 취소 감지됨');
        return;
      }

      // 새 씬 로드가 완전히 성공했을 때만 이전 씬들을 안전하게 정리
      if (oldSceneIndexes.length > 0) {
        try {
          await this.viewer.removeSplatScenes(oldSceneIndexes, false);
        } catch (removeErr) {
          console.warn('SplatManager: 이전 씬 정리 중 경고:', removeErr);
        }
      }

      if (this.viewer.webXRActive) {
        // WebXR VR 활성화 중 씬 전환 시 VR 렌더 루프 및 컨트롤러 인터랙션 보존
        this.ensureVRAnimationLoop();
      } else if (!this.viewer.selfDrivenModeRunning) {
        this.viewer.start();
      }

      // 현재 설정된 스플랫 스케일 및 포인트클라우드 모드 적용
      if (this.viewer.splatMesh) {
        this.viewer.splatMesh.setSplatScale(this.renderSettings.splatScale);
        this.viewer.splatMesh.setPointCloudModeEnabled(this.renderSettings.pointCloudMode);
      }

      // 카메라 시점 동기화
      if (sceneOptions.cameraPosition && sceneOptions.cameraLookAt) {
        this.resetCamera(sceneOptions.cameraPosition, sceneOptions.cameraLookAt, sceneOptions.cameraUp);
      } else {
        this.resetCamera();
      }

      if (this.viewer.splatMesh) {
        this.viewer.splatMesh.updateTransforms();
        this.viewer.splatMesh.visible = true;
      }

      this.currentSceneIndex = 0;
      this.isLoading = false;

      const splatCount = this.getSplatCount();
      const formatStr = this.detectFormatString(source);

      this.onProgress(100, '로딩 완료!');
      this.onSceneLoaded({
        splatCount,
        format: formatStr,
        source: typeof source === 'string' ? source : source.name
      });
    } catch (err) {
      this.isLoading = false;

      const isAborted = abortController.signal.aborted ||
                        err.name === 'AbortError' ||
                        err.message?.includes('aborted') ||
                        err.message?.includes('AbortablePromise');

      if (isAborted) {
        console.log('[SplatManager] 씬 로드가 안전하게 취소되었습니다:', err.message);
        return;
      }

      console.error('SplatManager: 씬 로드 실패:', err);
      this.onProgress(100, `로딩 에러: ${err.message}`);
      throw err;
    } finally {
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null;
        this.currentLoadPromise = null;
      }
    }
  }

  /**
   * 가우시안 스플랫 크기 배율 튜닝 (0.1 ~ 3.0)
   */
  setSplatScale(scale) {
    this.renderSettings.splatScale = scale;
    if (this.viewer && this.viewer.splatMesh) {
      this.viewer.splatMesh.setSplatScale(scale);
    }
  }

  /**
   * 포인트 클라우드 렌더 모드 토글
   */
  setPointCloudMode(enabled) {
    this.renderSettings.pointCloudMode = enabled;
    if (this.viewer && this.viewer.splatMesh) {
      this.viewer.splatMesh.setPointCloudModeEnabled(enabled);
    }
  }

  /**
   * 알파 컷오프 임계값 변경 후 씬 리로드
   */
  async setAlphaThreshold(threshold) {
    this.renderSettings.alphaThreshold = threshold;
    if (this.currentSource && !this.isLoading) {
      console.log(`SplatManager: 알파 임계값 ${threshold} 적용하여 씬 리로드`);
      await this.loadScene(this.currentSource, this.currentSceneOptions);
    }
  }

  /**
   * 기존 씬 해제
   */
  async clearCurrentScene() {
    if (this.viewer && this.viewer.splatMesh && this.viewer.splatMesh.scenes) {
      const sceneCount = this.viewer.splatMesh.scenes.length;
      if (sceneCount > 0) {
        const indexes = Array.from({ length: sceneCount }, (_, i) => i);
        try {
          await this.viewer.removeSplatScenes(indexes, false);
        } catch (e) {
          console.warn('SplatManager: 기존 씬 삭제 중 경고:', e);
        }
      }
    }
    this.currentSceneIndex = null;
  }

  /**
   * 카메라 위치 및 초점 초기화
   */
  resetCamera(position = null, lookAt = null, cameraUp = null) {
    if (!this.viewer || !this.viewer.camera) return;

    const targetPos = position || this.defaultCameraConfig.initialCameraPosition;
    const targetLookAt = lookAt || this.defaultCameraConfig.initialCameraLookAt;
    const upVector = cameraUp || this.defaultCameraConfig.cameraUp;

    this.viewer.camera.up.set(upVector[0], upVector[1], upVector[2]).normalize();
    this.viewer.camera.position.set(targetPos[0], targetPos[1], targetPos[2]);

    if (this.viewer.controls) {
      this.viewer.controls.target.set(targetLookAt[0], targetLookAt[1], targetLookAt[2]);
      this.viewer.controls.update();
    }
    this.viewer.camera.lookAt(targetLookAt[0], targetLookAt[1], targetLookAt[2]);
    this.viewer.camera.updateMatrixWorld(true);
  }

  /**
   * 현재 렌더링 중인 총 스플랫 개수 반환
   */
  getSplatCount() {
    if (this.viewer && this.viewer.splatMesh) {
      return this.viewer.splatMesh.getSplatCount() || 0;
    }
    return 0;
  }

  detectFormatString(source) {
    const name = typeof source === 'string' ? source : (source?.name || '');
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'ksplat') return 'KSPLAT (Compressed)';
    if (ext === 'splat') return 'SPLAT (Packed)';
    if (ext === 'ply') return 'PLY (Original)';
    return 'UNKNOWN';
  }

  getRenderer() {
    return this.viewer ? this.viewer.renderer : null;
  }

  getCamera() {
    return this.viewer ? this.viewer.camera : null;
  }

  getSplatMesh() {
    return this.viewer ? this.viewer.splatMesh : null;
  }

  /**
   * 모델의 시각적/기하학적 중심점(피벗) 반환
   */
  getModelCenter() {
    if (this.currentSceneOptions?.cameraLookAt) {
      const lookAt = this.currentSceneOptions.cameraLookAt;
      return new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2]);
    }
    const splatMesh = this.getSplatMesh();
    if (splatMesh && typeof splatMesh.computeBoundingBox === 'function') {
      try {
        const box = splatMesh.computeBoundingBox(true);
        const center = new THREE.Vector3();
        box.getCenter(center);
        if (Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z)) {
          return center;
        }
      } catch (e) {
        console.warn('[SplatManager] computeBoundingBox failed:', e);
      }
    }
    return new THREE.Vector3(0, 1.0, 0);
  }

  /**
   * 기존 GaussianSplats3D Viewer 리소스 및 렌더러 안전 해제
   */
  destroyViewer() {
    if (!this.viewer) return;

    try {
      if (this.viewer.requestFrameId) {
        cancelAnimationFrame(this.viewer.requestFrameId);
        this.viewer.requestFrameId = null;
      }
      if (typeof this.viewer.stop === 'function') {
        this.viewer.stop();
      }
      if (typeof this.viewer.removeEventHandlers === 'function') {
        this.viewer.removeEventHandlers();
      }
      if (this.viewer.splatMesh && typeof this.viewer.splatMesh.dispose === 'function') {
        this.viewer.splatMesh.dispose();
      }
      if (this.viewer.renderer) {
        if (typeof this.viewer.renderer.setAnimationLoop === 'function') {
          this.viewer.renderer.setAnimationLoop(null);
        }
        if (this.viewer.renderer.domElement && this.viewer.renderer.domElement.parentNode) {
          this.viewer.renderer.domElement.parentNode.removeChild(this.viewer.renderer.domElement);
        }
        if (typeof this.viewer.renderer.dispose === 'function') {
          this.viewer.renderer.dispose();
        }
      }
      if (typeof this.viewer.dispose === 'function') {
        this.viewer.dispose();
      }
    } catch (err) {
      console.warn('[SplatManager] destroyViewer warning:', err);
    }
    this.viewer = null;
  }

  /**
   * 새 GPU 메모리 프로필을 적용하여 Viewer를 안전하게 재구축하고 활성 씬 복원
   * @param {string} profileKey
   */
  async applyGpuProfile(profileKey) {
    const newProfile = getGpuProfile(profileKey);
    if (!newProfile) return;

    this.currentGpuProfileKey = newProfile.key;
    this.currentGpuProfile = newProfile;
    this.renderSettings.alphaThreshold = newProfile.sceneOptions.splatAlphaRemovalThreshold;

    const sourceToReload = this.currentSource;
    /** @type {Record<string, any>} */
    const sceneOptionsToReload = { ...this.currentSceneOptions };
    const savedCamPos = this.viewer?.camera?.position ? this.viewer.camera.position.toArray() : null;
    const savedCamLookAt = this.currentSceneOptions?.cameraLookAt || null;
    const savedCamUp = this.viewer?.camera?.up ? this.viewer.camera.up.toArray() : null;

    this.abortCurrentLoad('GPU 프로필 변경으로 인한 씬 재구축');

    this.destroyViewer();
    this.initViewer();

    if (sourceToReload) {
      if (savedCamPos && savedCamLookAt) {
        sceneOptionsToReload.cameraPosition = savedCamPos;
        sceneOptionsToReload.cameraLookAt = savedCamLookAt;
        if (savedCamUp) sceneOptionsToReload.cameraUp = savedCamUp;
      }
      await this.loadScene(sourceToReload, sceneOptionsToReload);
    }
  }

  /**
   * 현재 활성 GPU 메모리 튜닝 프로필 객체 반환
   * @returns {Object}
   */
  getCurrentGpuProfile() {
    return this.currentGpuProfile;
  }

  /**
   * 현재 활성 GPU 메모리 튜닝 프로필 키 반환
   * @returns {string}
   */
  getCurrentGpuProfileKey() {
    return this.currentGpuProfileKey;
  }

  /**
   * SplatManager 수명 주기 종료 및 전체 가우시안 씬 해제
   */
  async dispose() {
    this.abortCurrentLoad('SplatManager 종료');
    this.destroyViewer();
    this.threeScene = null;
    this.container = null;
  }
}
