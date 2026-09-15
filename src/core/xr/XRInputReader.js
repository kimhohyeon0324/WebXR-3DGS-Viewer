/**
 * WebXR Controller Input Reader & Haptic Feedback Module
 * 
 * 역할을 분리하여 Gamepad API의 버튼/스틱 상태 및 WebXR 입력 이벤트를 무할당(Zero-allocation)으로 폴링하고,
 * 컨트롤러 진동 펄스(Haptic Actuators)를 발송하는 순수 하드웨어 입력 수신 모듈입니다.
 */

/**
 * 표준 WebXR Gamepad API 버튼/축 인덱스 및 임계값 매핑 상수
 */
export const WEBXR_GAMEPAD_MAPPINGS = {
  BUTTON_TRIGGER: 0,
  BUTTON_GRIP: 1,
  BUTTON_RECENTER: 4,     // A (오른손) 또는 X (왼손)
  BUTTON_MODEL_TOGGLE: 5, // B (오른손) 또는 Y (왼손)
  AXIS_STICK_Y_PRIMARY: 3,
  AXIS_STICK_Y_SECONDARY: 1,
  THRESHOLD_TRIGGER: 0.15,
  THRESHOLD_GRIP: 0.15,
  THRESHOLD_STICK: 0.12,
  DEFAULT_HAPTIC_INTENSITY: 0.5,
  DEFAULT_HAPTIC_DURATION: 25
};

export class XRInputReader {
  /**
   * @param {Object} [options]
   * @param {Array<THREE.XRTargetRaySpace>} [options.controllers]
   * @param {Function} [options.onSelectStart] - 트리거 클릭 시 POI 피킹 우선 처리 콜백 ((ctrl) => boolean)
   * @param {Function} [options.onSelectEnd] - 트리거 해제 콜백
   * @param {Function} [options.onSqueezeStart] - 그립 누름 콜백
   * @param {Function} [options.onSqueezeEnd] - 그립 해제 콜백
   */
  constructor(options = {}) {
    this.controllers = options.controllers || [];
    this.onSelectStart = options.onSelectStart || null;
    this.onSelectEnd = options.onSelectEnd || null;
    this.onSqueezeStart = options.onSqueezeStart || null;
    this.onSqueezeEnd = options.onSqueezeEnd || null;

    // 매 프레임 GC 발생을 원천 차단하기 위한 재사용 입력 상태 객체
    this.state = {
      leftController: null,
      rightController: null,
      leftTrigger: false,
      rightTrigger: false,
      leftGrip: false,
      rightGrip: false,
      recenterPressed: false,
      recenterSource: null,
      presetTogglePressed: false,
      presetToggleSource: null,
      stickZoom: 0,
    };

    this.bindControllerEvents();
  }

  setControllers(controllers) {
    this.controllers = controllers || [];
    this.bindControllerEvents();
  }

  /**
   * 컨트롤러 진동(햅틱) 펄스 발생
   * @param {THREE.XRTargetRaySpace} controller
   * @param {number} intensity 진동 강도 (0.0 ~ 1.0)
   * @param {number} durationMs 진동 지속 시간 (ms)
   */
  triggerHaptic(controller, intensity = WEBXR_GAMEPAD_MAPPINGS.DEFAULT_HAPTIC_INTENSITY, durationMs = WEBXR_GAMEPAD_MAPPINGS.DEFAULT_HAPTIC_DURATION) {
    const gamepad = controller?.userData?.inputSource?.gamepad;
    if (gamepad?.hapticActuators && gamepad.hapticActuators[0]) {
      gamepad.hapticActuators[0].pulse(intensity, durationMs).catch(() => {});
    }
  }

  /**
   * 컨트롤러 WebXR 이벤트 바인딩
   * - Trigger: POI 핀 피킹 및 빈 공간 잡기 등록
   * - Grip: 100% 모델 잡기 전담
   */
  bindControllerEvents() {
    this.controllers.forEach((controller) => {
      if (!controller) return;

      // 1. 트리거(Trigger / select) 누름
      controller.addEventListener('selectstart', () => {
        if (typeof this.onSelectStart === 'function') {
          const handled = this.onSelectStart(controller);
          if (handled) return;
        }
        controller.userData.isPickingPOI = false;
        controller.userData.isTriggerHeld = true;
      });

      controller.addEventListener('selectend', () => {
        controller.userData.isPickingPOI = false;
        controller.userData.isTriggerHeld = false;
        if (typeof this.onSelectEnd === 'function') {
          this.onSelectEnd(controller);
        }
      });

      // 2. 그립(Grip / squeeze) 누름
      controller.addEventListener('squeezestart', () => {
        controller.userData.isGripHeld = true;
        if (typeof this.onSqueezeStart === 'function') {
          this.onSqueezeStart(controller);
        }
      });

      controller.addEventListener('squeezeend', () => {
        controller.userData.isGripHeld = false;
        if (typeof this.onSqueezeEnd === 'function') {
          this.onSqueezeEnd(controller);
        }
      });
    });
  }

  /**
   * 컨트롤러 동적 연결/해제(inputsourceschange) 시 입력 소스 매핑을 갱신
   * @param {XRSession} session
   */
  updateInputSources(session) {
    if (!session || !session.inputSources) return;
    for (let i = 0; i < this.controllers.length; i++) {
      const ctrl = this.controllers[i];
      if (!ctrl) continue;
      const handedness = ctrl.userData?.handedness || (i === 0 ? 'right' : 'left');
      for (let s = 0; s < session.inputSources.length; s++) {
        const src = session.inputSources[s];
        if (src && src.handedness === handedness) {
          ctrl.userData.inputSource = src;
          break;
        }
      }
    }
  }

  /**
   * 매 WebXR 프레임마다 Gamepad API 및 버튼 상태를 폴링하여 재사용 객체에 기록
   * @param {XRSession} session
   * @returns {Object} this.state
   */
  poll(session) {
    const s = this.state;
    s.leftController = null;
    s.rightController = null;
    s.leftTrigger = false;
    s.rightTrigger = false;
    s.leftGrip = false;
    s.rightGrip = false;
    s.recenterPressed = false;
    s.recenterSource = null;
    s.presetTogglePressed = false;
    s.presetToggleSource = null;
    s.stickZoom = 0;

    for (let i = 0; i < this.controllers.length; i++) {
      const ctrl = this.controllers[i];
      if (!ctrl) continue;
      const handedness = ctrl.userData?.handedness || (i === 0 ? 'right' : 'left');

      let gamepad = ctrl.userData?.inputSource?.gamepad;
      if (!gamepad && session?.inputSources) {
        for (let j = 0; j < session.inputSources.length; j++) {
          const src = session.inputSources[j];
          if (src && src.handedness === handedness && src.gamepad) {
            gamepad = src.gamepad;
            ctrl.userData.inputSource = src;
            break;
          }
        }
      }

      // 1) 트리거(Trigger): 버튼 인덱스
      const triggerEvent = !!ctrl.userData?.isTriggerHeld;
      const triggerGamepad = !ctrl.userData?.isPickingPOI && (
        gamepad?.buttons[WEBXR_GAMEPAD_MAPPINGS.BUTTON_TRIGGER]?.pressed ||
        gamepad?.buttons[WEBXR_GAMEPAD_MAPPINGS.BUTTON_TRIGGER]?.value > WEBXR_GAMEPAD_MAPPINGS.THRESHOLD_TRIGGER
      );
      const isTrigger = triggerEvent || triggerGamepad;

      // 2) 그립(Grip/Squeeze): 버튼 인덱스
      const gripEvent = !!ctrl.userData?.isGripHeld;
      const gripGamepad = (
        gamepad?.buttons[WEBXR_GAMEPAD_MAPPINGS.BUTTON_GRIP]?.pressed ||
        gamepad?.buttons[WEBXR_GAMEPAD_MAPPINGS.BUTTON_GRIP]?.value > WEBXR_GAMEPAD_MAPPINGS.THRESHOLD_GRIP
      );
      const isGrip = gripEvent || gripGamepad;

      // 3) 썸스틱(Thumbstick) 상/하: 기본 축 또는 보조 축
      if (gamepad?.axes) {
        let axisY = 0;
        const pAxis = WEBXR_GAMEPAD_MAPPINGS.AXIS_STICK_Y_PRIMARY;
        const sAxis = WEBXR_GAMEPAD_MAPPINGS.AXIS_STICK_Y_SECONDARY;
        const deadzone = WEBXR_GAMEPAD_MAPPINGS.THRESHOLD_STICK;

        if (gamepad.axes.length > pAxis && Math.abs(gamepad.axes[pAxis]) > deadzone) {
          axisY = gamepad.axes[pAxis];
        } else if (gamepad.axes.length > sAxis && Math.abs(gamepad.axes[sAxis]) > deadzone) {
          axisY = gamepad.axes[sAxis];
        }
        if (Number.isFinite(axisY) && Math.abs(axisY) > deadzone) {
          s.stickZoom += axisY;
        }
      }

      // 4) A / X 버튼: 시점 리셋
      if (gamepad?.buttons[WEBXR_GAMEPAD_MAPPINGS.BUTTON_RECENTER]?.pressed) {
        s.recenterPressed = true;
        s.recenterSource = ctrl;
      }

      // 5) B / Y 버튼: 프리셋 모델 토글
      if (gamepad?.buttons[WEBXR_GAMEPAD_MAPPINGS.BUTTON_MODEL_TOGGLE]?.pressed) {
        s.presetTogglePressed = true;
        s.presetToggleSource = ctrl;
      }

      if (handedness === 'left') {
        s.leftController = ctrl;
        s.leftTrigger = isTrigger;
        s.leftGrip = isGrip;
      } else if (handedness === 'right') {
        s.rightController = ctrl;
        s.rightTrigger = isTrigger;
        s.rightGrip = isGrip;
      }
    }

    return s;
  }
}
