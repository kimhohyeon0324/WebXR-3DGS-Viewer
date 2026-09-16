import { describe, it, expect, vi, beforeEach } from 'vitest';
import { XRInputReader, WEBXR_GAMEPAD_MAPPINGS } from '../src/core/xr/XRInputReader.js';

function createMockController(handedness = 'right') {
  const listeners = {};
  return {
    name: `controller_${handedness}`,
    userData: { handedness },
    addEventListener: (evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    dispatchEvent: (evt) => {
      if (listeners[evt]) {
        listeners[evt].forEach(fn => fn());
      }
    }
  };
}

function createMockGamepad({ pressedButtons = [], buttonValues = {}, axes = [0, 0, 0, 0], pulseFn = vi.fn().mockResolvedValue(true) } = {}) {
  const buttons = Array.from({ length: 6 }, (_, i) => ({
    pressed: pressedButtons.includes(i),
    value: buttonValues[i] !== undefined ? buttonValues[i] : (pressedButtons.includes(i) ? 1.0 : 0.0)
  }));

  return {
    buttons,
    axes,
    hapticActuators: [{ pulse: pulseFn }]
  };
}

describe('XRInputReader - WebXR 하드웨어 입력 및 햅틱 모듈 단위 테스트', () => {
  let leftCtrl;
  let rightCtrl;
  let inputReader;

  beforeEach(() => {
    leftCtrl = createMockController('left');
    rightCtrl = createMockController('right');
    inputReader = new XRInputReader({
      controllers: [rightCtrl, leftCtrl]
    });
  });

  describe('1. 매핑 상수(WEBXR_GAMEPAD_MAPPINGS) 무결성', () => {
    it('표준 WebXR Gamepad API 버튼 및 축 인덱스, 임계값이 올바르게 정의되어야 한다', () => {
      expect(WEBXR_GAMEPAD_MAPPINGS.BUTTON_TRIGGER).toBe(0);
      expect(WEBXR_GAMEPAD_MAPPINGS.BUTTON_GRIP).toBe(1);
      expect(WEBXR_GAMEPAD_MAPPINGS.BUTTON_RECENTER).toBe(4);
      expect(WEBXR_GAMEPAD_MAPPINGS.BUTTON_MODEL_TOGGLE).toBe(5);
      expect(WEBXR_GAMEPAD_MAPPINGS.THRESHOLD_TRIGGER).toBeCloseTo(0.15);
      expect(WEBXR_GAMEPAD_MAPPINGS.THRESHOLD_STICK).toBeCloseTo(0.12);
    });
  });

  describe('2. 트리거 및 그립 버튼 폴링(poll)', () => {
    it('오른손 트리거(버튼 0) 아날로그 입력이 임계값(0.15)을 넘으면 rightTrigger가 true가 되어야 한다', () => {
      rightCtrl.userData.inputSource = {
        handedness: 'right',
        gamepad: createMockGamepad({ buttonValues: { 0: 0.5 } })
      };

      const state = inputReader.poll();
      expect(state.rightTrigger).toBe(true);
      expect(state.leftTrigger).toBe(false);
    });

    it('트리거 입력이 임계값(0.15) 이하이면 트리거가 작동하지 않아야 한다', () => {
      rightCtrl.userData.inputSource = {
        handedness: 'right',
        gamepad: createMockGamepad({ buttonValues: { 0: 0.10 } })
      };

      const state = inputReader.poll();
      expect(state.rightTrigger).toBe(false);
    });

    it('왼손 그립(버튼 1) 누름 시 leftGrip이 true가 되어야 한다', () => {
      leftCtrl.userData.inputSource = {
        handedness: 'left',
        gamepad: createMockGamepad({ pressedButtons: [1] })
      };

      const state = inputReader.poll();
      expect(state.leftGrip).toBe(true);
      expect(state.rightGrip).toBe(false);
    });
  });

  describe('3. 썸스틱 줌 및 데드존(0.12) 필터링', () => {
    it('썸스틱 편차가 데드존(0.12) 이하이면 stickZoom이 0이어야 한다', () => {
      rightCtrl.userData.inputSource = {
        handedness: 'right',
        gamepad: createMockGamepad({ axes: [0, 0, 0, 0.08] })
      };

      const state = inputReader.poll();
      expect(state.stickZoom).toBe(0);
    });

    it('기본 축(axes[3])이 데드존을 초과하면 stickZoom에 누적되어야 한다', () => {
      rightCtrl.userData.inputSource = {
        handedness: 'right',
        gamepad: createMockGamepad({ axes: [0, 0, 0, -0.65] })
      };

      const state = inputReader.poll();
      expect(state.stickZoom).toBeCloseTo(-0.65);
    });

    it('보조 축(axes[1])도 axes[3]이 없을 때 정상 작동해야 한다', () => {
      rightCtrl.userData.inputSource = {
        handedness: 'right',
        gamepad: createMockGamepad({ axes: [0, 0.55] })
      };

      const state = inputReader.poll();
      expect(state.stickZoom).toBeCloseTo(0.55);
    });
  });

  describe('4. 리센터(A/X) 및 프리셋 토글(B/Y) 버튼 감지', () => {
    it('버튼 4가 눌리면 recenterPressed가 true가 되고 컨트롤러 소스가 저장되어야 한다', () => {
      rightCtrl.userData.inputSource = {
        handedness: 'right',
        gamepad: createMockGamepad({ pressedButtons: [4] })
      };

      const state = inputReader.poll();
      expect(state.recenterPressed).toBe(true);
      expect(state.recenterSource).toBe(rightCtrl);
    });

    it('버튼 5가 눌리면 presetTogglePressed가 true가 되어야 한다', () => {
      leftCtrl.userData.inputSource = {
        handedness: 'left',
        gamepad: createMockGamepad({ pressedButtons: [5] })
      };

      const state = inputReader.poll();
      expect(state.presetTogglePressed).toBe(true);
      expect(state.presetToggleSource).toBe(leftCtrl);
    });
  });

  describe('5. WebXR 컨트롤러 이벤트 및 햅틱 발송', () => {
    it('selectstart / selectend 이벤트 발생 시 userData 플래그가 정상 토글되어야 한다', () => {
      rightCtrl.dispatchEvent('selectstart');
      expect(rightCtrl.userData.isTriggerHeld).toBe(true);

      rightCtrl.dispatchEvent('selectend');
      expect(rightCtrl.userData.isTriggerHeld).toBe(false);
    });

    it('triggerHaptic 호출 시 gamepad.hapticActuators[0].pulse가 올바른 파라미터로 호출되어야 한다', () => {
      const pulseMock = vi.fn().mockResolvedValue(true);
      rightCtrl.userData.inputSource = {
        gamepad: createMockGamepad({ pulseFn: pulseMock })
      };

      inputReader.triggerHaptic(rightCtrl, 0.7, 30);
      expect(pulseMock).toHaveBeenCalledWith(0.7, 30);
    });

    it('updateInputSources 호출 시 session의 inputSources가 handedness에 맞춰 바인딩되어야 한다', () => {
      const mockSession = {
        inputSources: [
          { handedness: 'left', id: 'src_left' },
          { handedness: 'right', id: 'src_right' }
        ]
      };

      inputReader.updateInputSources(mockSession);
      expect(leftCtrl.userData.inputSource.id).toBe('src_left');
      expect(rightCtrl.userData.inputSource.id).toBe('src_right');
    });
  });
});
