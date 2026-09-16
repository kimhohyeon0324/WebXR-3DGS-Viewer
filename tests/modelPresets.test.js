import { describe, it, expect } from 'vitest';
import { PRESET_MODELS, DEFAULT_MODEL_KEY, getNextPresetKey } from '../src/data/modelPresets.js';

describe('modelPresets - 프리셋 모델 및 원형 순환 스위처 단위 테스트', () => {
  it('기본 모델 키(DEFAULT_MODEL_KEY)가 등록된 프리셋에 존재해야 한다', () => {
    expect(PRESET_MODELS[DEFAULT_MODEL_KEY]).toBeDefined();
    expect(PRESET_MODELS[DEFAULT_MODEL_KEY].path).toContain('.ksplat');
  });

  it('등록된 모든 프리셋이 필수 속성(name, path, position, rotation, scale, cameraPosition, cameraLookAt)을 갖추어야 한다', () => {
    for (const [_key, preset] of Object.entries(PRESET_MODELS)) {
      expect(preset.name).toBeTruthy();
      expect(preset.path).toBeTruthy();
      expect(preset.position).toHaveLength(3);
      expect(preset.rotation).toHaveLength(4);
      expect(preset.scale).toHaveLength(3);
      expect(preset.cameraPosition).toHaveLength(3);
      expect(preset.cameraLookAt).toHaveLength(3);
      expect(preset.cameraUp).toHaveLength(3);
    }
  });

  it('getNextPresetKey가 N개 모델에 대해 원형 순환(Circular Indexing)해야 한다', () => {
    const keys = Object.keys(PRESET_MODELS);
    expect(keys.length).toBeGreaterThanOrEqual(2);

    let curr = keys[0];
    for (let i = 0; i < keys.length; i++) {
      const next = getNextPresetKey(curr);
      const expectedNext = keys[(i + 1) % keys.length];
      expect(next).toBe(expectedNext);
      curr = next;
    }
    // 한 바퀴 돌고 나면 최초 키로 원위치
    expect(curr).toBe(keys[0]);
  });

  it('존재하지 않는 키를 전달할 경우 첫 번째 기본 키를 반환해야 한다', () => {
    const fallback = getNextPresetKey('unknown_model_key');
    expect(fallback).toBe(Object.keys(PRESET_MODELS)[0]);
  });
});
