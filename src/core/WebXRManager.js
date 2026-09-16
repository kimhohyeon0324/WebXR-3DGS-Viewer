import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRInteractionManager } from './XRInteractionManager.js';

/**
 * Three.js WebXR 몰입형 세션 및 6DoF 컨트롤러, 인터랙션 생명주기 관리자
 */
export class WebXRManager {
  /**
   * @param {Object} [options]
   * @param {THREE.WebGLRenderer} [options.renderer] - Three.js WebGL 렌더러
   * @param {THREE.PerspectiveCamera} [options.camera] - Three.js 메인 카메라
   * @param {THREE.Scene} [options.scene] - Three.js 씬
   * @param {HTMLElement} [options.buttonContainer] - VR 버튼이 삽입될 DOM 컨테이너
   * @param {Object} [options.poiManager] - 3D POI 관리자 참조
   * @param {Object} [options.splatManager] - 3DGS 스플랫 관리자 참조
   * @param {Function} [options.onModelToggle] - 모델 토글 콜백
   * @param {Function} [options.onSessionStart] - VR 세션 시작 콜백
   * @param {Function} [options.onSessionEnd] - VR 세션 종료 콜백
   */
  constructor(options = {}) {
    this.renderer = options.renderer;
    this.camera = options.camera;
    this.scene = options.scene;
    this.buttonContainer = options.buttonContainer || document.body;
    this.poiManager = options.poiManager || null;
    this.splatManager = options.splatManager || null;
    this.onModelToggle = options.onModelToggle || null;
    this.onSessionStart = options.onSessionStart || (() => {});
    this.onSessionEnd = options.onSessionEnd || (() => {});

    this.isVRSupported = false;
    this.isPresenting = false;
    this.vrButtonElement = null;

    // WebXR 카메라 리그 (공간 이동 및 텔레포트의 기준이 되는 최상위 그룹)
    this.cameraRig = new THREE.Group();
    this.cameraRig.name = 'WebXRCameraRig';
    this.scene.add(this.cameraRig);

    // 주의: this.camera를 cameraRig의 자식으로 추가하면 Three.js와 GaussianSplats3D의
    // 카메라 월드 변환 및 OrbitControls 행렬이 충돌하여 가우시안 렌더링이 실패합니다.
    // 카메라는 독립 루트(parent === null)로 유지합니다.

    // 컨트롤러 및 그립 모델
    this.controllers = [];
    this.controllerGrips = [];
    this.controllerModelFactory = new XRControllerModelFactory();

    // 6DoF 인터랙션 관리자
    this.interactionManager = null;

    this.initXR();
  }

  setPOIManager(poiManager) {
    this.poiManager = poiManager;
    if (this.interactionManager) {
      this.interactionManager.setPOIManager(poiManager);
    }
  }

  /**
   * WebXR 렌더러 활성화 및 세션 이벤트 바인딩
   */
  initXR() {
    if (!this.renderer) {
      console.error('WebXRManager: WebGLRenderer가 제공되지 않았습니다.');
      return;
    }

    // WebXR 활성화
    this.renderer.xr.enabled = true;
    try {
      this.renderer.xr.setReferenceSpaceType('local-floor');
    } catch (e) {
      console.warn('WebXRManager: local-floor 설정 대기 (세션 생성 시 적용):', e);
    }

    // VRButton 생성 및 UI 삽입
    this.setupVRButton();

    // 컨트롤러 설정
    this.setupControllers();

    // 인터랙션 매니저 초기화
    this.interactionManager = new XRInteractionManager({
      renderer: this.renderer,
      camera: this.camera,
      cameraRig: this.cameraRig,
      scene: this.scene,
      controllers: this.controllers,
      targetScene: this.scene,
      poiManager: this.poiManager,
      splatManager: this.splatManager,
      onModelToggle: this.onModelToggle
    });

    // 세션 생명주기 이벤트
    this.renderer.xr.addEventListener('sessionstart', (_event) => {
      this.isPresenting = true;
      console.log('WebXRManager: VR Session Started!');
      
      // VR 모드 진입 시 카메라 리그 위치 초기화 (바닥 기준 y=0)
      this.cameraRig.position.set(0, 0, 0);
      this.cameraRig.rotation.set(0, 0, 0);

      if (this.interactionManager) {
        this.interactionManager.activate();
      }

      const session = this.renderer.xr.getSession();
      if (session) {
        session.addEventListener('inputsourceschange', () => {
          if (this.interactionManager) {
            this.interactionManager.updateInputSources(session);
          }
        });
      }

      this.onSessionStart({
        session: session,
        cameraRig: this.cameraRig
      });
    });

    this.renderer.xr.addEventListener('sessionend', (_event) => {
      this.isPresenting = false;
      console.log('WebXRManager: VR Session Ended.');

      if (this.interactionManager) {
        this.interactionManager.deactivate();
      }

      this.onSessionEnd();
    });

    // 브라우저 VR 지원 여부 비동기 검사
    if ('xr' in navigator) {
      navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        this.isVRSupported = supported;
        console.log(`WebXRManager: 'immersive-vr' supported = ${supported}`);
      }).catch((err) => {
        console.warn('WebXRManager: WebXR 지원 여부 확인 중 오류:', err);
      });
    }
  }

  /**
   * VRButton 생성 및 커스텀 스타일링
   */
  setupVRButton() {
    const sessionInit = {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
    };

    const button = VRButton.createButton(this.renderer, sessionInit);
    button.id = 'webxr-vr-button';
    button.classList.add('hud-vr-btn');
    
    button.style.position = '';
    button.style.bottom = '';
    button.style.left = '';
    button.style.opacity = '';

    this.vrButtonElement = button;
    this.buttonContainer.appendChild(button);
  }

  /**
   * 6DoF 컨트롤러 및 레이저 가이드라인 구성
   */
  setupControllers() {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      this.cameraRig.add(controller);

      // WebXR 세션에서 컨트롤러가 연결될 때 handedness ('left' | 'right') 정확히 바인딩
      controller.addEventListener('connected', (event) => {
        controller.userData.handedness = event.data.handedness;
        controller.userData.inputSource = event.data;
        console.log(`[WebXRManager] Controller ${i} connected as handedness: ${event.data.handedness}`);
      });

      controller.addEventListener('disconnected', () => {
        controller.userData.handedness = null;
        controller.userData.inputSource = null;
      });

      const laserGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -5)
      ]);
      const laserMaterial = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.6,
        linewidth: 2
      });
      const laser = new THREE.Line(laserGeometry, laserMaterial);
      laser.name = 'laserGuide';
      controller.add(laser);

      this.controllers.push(controller);

      const grip = this.renderer.xr.getControllerGrip(i);
      grip.name = `grip_${i}`;
      grip.add(this.controllerModelFactory.createControllerModel(grip));
      this.cameraRig.add(grip);

      this.controllerGrips.push(grip);
    }
  }

  /**
   * 매 WebXR 프레임 업데이트
   */
  update(delta = 0.016) {
    if (this.isPresenting && this.interactionManager) {
      this.interactionManager.update(delta);
    }
  }

  getControllers() {
    return this.controllers;
  }

  getCameraRig() {
    return this.cameraRig;
  }

  getInteractionManager() {
    return this.interactionManager;
  }

  setPivotOffset(offset) {
    if (this.interactionManager) {
      this.interactionManager.setPivotOffset(offset);
    }
  }
}
