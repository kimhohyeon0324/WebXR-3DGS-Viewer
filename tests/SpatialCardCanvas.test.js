import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

describe('SpatialCardCanvas - VR 3D 공간 정보 카드용 2D 텍스처 팩토리 단위 테스트', () => {
  let mockContext2D;
  let mockCanvas;
  let originalDocument;
  let SpatialCardCanvas;

  beforeEach(async () => {
    let strokeStyles = [];
    mockContext2D = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn((text) => ({ width: text.length * 10 })),
      fillStyle: '',
      get strokeStyle() { return strokeStyles[strokeStyles.length - 1] || ''; },
      set strokeStyle(val) { strokeStyles.push(val); },
      lineWidth: 1,
      font: '',
      textAlign: '',
      textBaseline: '',
      _strokeStyles: strokeStyles
    };

    mockCanvas = {
      width: 512,
      height: 256,
      getContext: vi.fn((type) => (type === '2d' ? mockContext2D : null))
    };

    originalDocument = globalThis.document;
    globalThis.document = {
      createElement: vi.fn((tag) => (tag === 'canvas' ? mockCanvas : {}))
    };

    const module = await import('../src/core/poi/SpatialCardCanvas.js');
    SpatialCardCanvas = module.SpatialCardCanvas;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  describe('1. 초기화 및 텍스처 생성', () => {
    it('지정된 해상도(512x256)로 Canvas 및 THREE.CanvasTexture를 생성해야 한다', () => {
      const card = new SpatialCardCanvas(512, 256);
      expect(card.width).toBe(512);
      expect(card.height).toBe(256);
      expect(card.getTexture()).toBeInstanceOf(THREE.CanvasTexture);
      expect(card.getTexture().minFilter).toBe(THREE.LinearFilter);
      expect(card.getTexture().magFilter).toBe(THREE.LinearFilter);
    });
  });

  describe('2. 카드 메타데이터 렌더링 (renderCard)', () => {
    it('기본 메타데이터가 주어졌을 때 Canvas에 배경, 테두리, 텍스트가 그려져야 한다', () => {
      const card = new SpatialCardCanvas();
      const poiData = {
        id: 'poi_test',
        title: 'Bonsai Branch',
        type: 'visual',
        description: 'Bonsai branch with lush leaves',
        coordinates: new THREE.Vector3(0.1, 1.2, -0.3)
      };

      card.renderCard(poiData);

      expect(mockContext2D.clearRect).toHaveBeenCalledWith(0, 0, 512, 256);
      expect(mockContext2D.fillText).toHaveBeenCalledWith('VISUAL', expect.any(Number), expect.any(Number));
      expect(mockContext2D.fillText).toHaveBeenCalledWith('Bonsai Branch', 120, 36);
      expect(card.getTexture().version).toBeGreaterThan(0);
    });

    it('haptic 타입 POI는 앰버 색상 테두리와 뱃지가 적용되어야 한다', () => {
      const card = new SpatialCardCanvas();
      card.renderCard({ type: 'haptic', title: 'Haptic Spot' });

      expect(mockContext2D.fillText).toHaveBeenCalledWith('HAPTIC', expect.any(Number), expect.any(Number));
      expect(mockContext2D._strokeStyles).toContain('rgba(245, 158, 11, 0.9)');
    });
  });

  describe('3. 텍스트 자동 줄바꿈 (_wrapText)', () => {
    it('지정된 maxWidth를 초과하는 긴 텍스트는 여러 줄로 분할되어 렌더링되어야 한다', () => {
      const card = new SpatialCardCanvas();
      // 글자당 10px로 모킹됨: 20글자 = 200px > maxWidth(100px)
      mockContext2D.fillText.mockClear();
      card._wrapText(mockContext2D, 'abcdefghijklmnopqrst', 24, 100, 100, 20);

      // 최소 2회 이상 fillText가 호출되어야 함
      expect(mockContext2D.fillText.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('4. 리소스 해제 (dispose)', () => {
    it('dispose 호출 시 CanvasTexture를 dispose하고 메모리 참조를 정리해야 한다', () => {
      const card = new SpatialCardCanvas();
      const texture = card.getTexture();
      const disposeSpy = vi.spyOn(texture, 'dispose');

      card.dispose();

      expect(disposeSpy).toHaveBeenCalled();
      expect(card.texture).toBeNull();
      expect(card.canvas).toBeNull();
      expect(card.ctx).toBeNull();
    });
  });
});
