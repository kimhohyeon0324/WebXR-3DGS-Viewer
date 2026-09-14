import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

/**
 * 3D Gaussian Splatting 코어 렌더링 및 씬 라이프사이클 관리자
 */
export class SplatManager {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - 캔버스가 마운트될 DOM 컨테이너
   * @param {THREE.Scene} [options.threeScene] - 3DGS와 합성 렌더링할 Three.js 씬
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

    // 현재 렌더 튜닝 파라미터 상태 (기본값)
    this.renderSettings = {
      splatScale: 1.0,
      alphaThreshold: 5,
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
   * GaussianSplats3D.Viewer 초기화
   */
  initViewer() {
    const canUseSharedMemory = typeof window !== 'undefined' && !!window.crossOriginIsolated;

    this.viewer = new GaussianSplats3D.Viewer({
      rootElement: this.container,
      threeScene: this.threeScene,
      cameraUp: this.defaultCameraConfig.cameraUp,
      initialCameraPosition: this.defaultCameraConfig.initialCameraPosition,
      initialCameraLookAt: this.defaultCameraConfig.initialCameraLookAt,
      useBuiltInControls: true,
      selfDrivenMode: true,
      gpuAcceleratedSort: canUseSharedMemory, // SharedArrayBuffer 지원 시 GPU 가속 정렬 가동
      sharedMemoryForWorkers: canUseSharedMemory, // Cross-Origin Isolation 시 제로카피 SharedArrayBuffer 활성화
      integerBasedSort: true,
      dynamicScene: false, // 로드 시점에 트랜스폼 베이킹(안정성 극대화)
      halfPrecisionCovariancesOnGPU: false,
      sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
      logLevel: GaussianSplats3D.LogLevel.None
    });
  }

  /**
   * WebXR VR 세션 진입 처리
   */
  enterVR(onXRFrame = null) {
    if (!this.viewer) return;

    if (this.viewer.requestFrameId) {
      cancelAnimationFrame(this.viewer.requestFrameId);
      this.viewer.requestFrameId = null;
    }

    this.viewer.webXRActive = true;

    if (this.viewer.renderer && this.viewer.selfDrivenUpdateFunc) {
      this.viewer.renderer.setAnimationLoop((time, frame) => {
        if (typeof onXRFrame === 'function') {
          onXRFrame(time, frame);
        }
        this.viewer.selfDrivenUpdate();
      });
    }

    console.log('SplatManager: WebXR 스테레오 렌더 루프 가동');
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

    if (this.viewer.selfDrivenMode && this.viewer.selfDrivenUpdateFunc) {
      this.viewer.requestFrameId = requestAnimationFrame(this.viewer.selfDrivenUpdateFunc);
    }

    this.resetCamera();
    console.log('SplatManager: PC 렌더 루프 복귀');
  }

  /**
   * 씬 로드 (파일 경로 또는 File/Blob 객체)
   */
  async loadScene(source, sceneOptions = {}) {
    if (this.isLoading) {
      console.warn('SplatManager: 이미 다른 씬이 로딩 중입니다.');
      return;
    }

    this.isLoading = true;
    this.currentSource = source;
    this.currentSceneOptions = sceneOptions;
    this.onProgress(0, '3DGS 가우시안 씬 준비 중...');

    try {
      await this.clearCurrentScene();

      let format = null;
      let pathOrFile = source;

      if (source instanceof File) {
        const ext = source.name.split('.').pop().toLowerCase();
        if (ext === 'ply') format = GaussianSplats3D.SceneFormat.Ply;
        else if (ext === 'splat') format = GaussianSplats3D.SceneFormat.Splat;
        else if (ext === 'ksplat') format = GaussianSplats3D.SceneFormat.KSplat;
      }

      const defaultOptions = {
        splatAlphaRemovalThreshold: this.renderSettings.alphaThreshold,
        showLoadingUI: false,
        progressiveLoad: true, // 점진적 스트리밍 렌더링 활성화 (첫 청크 도착 즉시 화면 렌더링 시작)
        position: [0, 1, 0],
        rotation: [0, 0, 0, 1],
        scale: [1.5, 1.5, 1.5],
        onProgress: (percent, percentText, status) => {
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

      await this.viewer.addSplatScene(pathOrFile, defaultOptions);

      if (!this.viewer.running) {
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
      console.error('SplatManager: 씬 로드 실패:', err);
      this.onProgress(100, `로딩 에러: ${err.message}`);
      throw err;
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
    if (this.viewer) {
      // 점진적 백그라운드 다운로드/빌드가 남아있는 경우 안전하게 대기
      if (this.viewer.splatSceneDownloadAndBuildPromise) {
        try {
          await this.viewer.splatSceneDownloadAndBuildPromise;
        } catch (e) {
          console.warn('SplatManager: 이전 씬 다운로드 완료 대기 중 예외:', e);
        }
      }
      if (this.viewer.splatMesh && this.viewer.splatMesh.scenes) {
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
}
