# WebXR 3D Gaussian Splatting (3DGS) Interactive Viewer

> **3D 가우시안 스플래팅 기반 실시간 WebXR 인터랙티브 뷰어 시스템**  
> WebGL 2.0 및 WebXR Device API를 기반으로, 브라우저 및 Meta Quest 독립형 환경에서 60~90 FPS의 안정적인 공간 탐색과 6DoF 인터랙션을 제공합니다.

[![Three.js](https://img.shields.io/badge/Three.js-r160-black.svg)](https://threejs.org/)
[![WebXR](https://img.shields.io/badge/WebXR-Meta%20Quest%202%2F3%2FPro-blue.svg)](https://immersiveweb.dev/)
[![WebGL 2.0](https://img.shields.io/badge/WebGL-2.0-990000.svg)](https://www.khronos.org/webgl/)
[![Vite](https://img.shields.io/badge/Vite-5.x-646CFF.svg)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

### 메인 뷰어 실행 화면

| Bonsai Tree (경량 .ksplat 씬) | Golden Dragon (.splat 씬) |
| :---: | :---: |
| ![Bonsai Tree Scene](docs/images/showcase_bonsai.png) | ![Golden Dragon Scene](docs/images/showcase_dragon.png) |

---

## 1. 프로젝트 개요

* **기술 스택**: 
  - **Core**: WebGL 2.0, WebXR Device API, JavaScript (ES6+ Module)
  - **3D Engine & Splatting**: Three.js (r160), `@mkkellogg/gaussian-splats-3d` (v0.4.7)
  - **Tooling & Build**: Vite, `@vitejs/plugin-basic-ssl`
  - **Target Device**: 데스크톱 웹 브라우저 (Chrome/Edge), Meta Quest 2/3/Pro (Oculus Browser)

---

## 2. 문제 의식

1. **모바일 VR 기기(Meta Quest)의 렌더링 과부하**:
   - 3DGS는 고성능 PC에서는 빠르지만, 수십만 개의 반투명 입자가 겹쳐 렌더링되는 특성상 Meta Quest와 같은 모바일 VR 기기에서는 화면을 덧칠하는 연산량(오버드로우)이 급증하여 프레임이 급격히 떨어지는 한계가 있음.
2. **실시간 시점 정렬 연산으로 인한 화면 끊김**:
   - 사용자 시점 변화에 맞춰 수십만 개의 입자를 앞뒤 순서대로 매 프레임 정렬해야 하는데, 이를 브라우저 메인 스레드에서 처리하면 화면이 뚝뚝 끊기며 심한 VR 멀미를 유발함.
3. **WebXR 기반 6DoF 공간 조작 환경의 부재**:
   - 기존 웹 기반 3DGS 뷰어들은 대부분 마우스 회전 수준에 머물러 있어, VR 헤드셋 환경에서 자유롭게 걸어 다니거나 텔레포트하고, 양손으로 공간 크기를 조절하는 통합 조작 시스템이 부족함.

---

## 3. 시스템 아키텍처

```mermaid
flowchart TB
    subgraph Data["1. 3DGS 데이터 인입"]
        PLY[".ply / .splat / .ksplat"]
    end

    subgraph Core["2. 렌더링 파이프라인"]
        SM["SplatManager\n(@mkkellogg/gaussian-splats-3d)"]
        WASM["Web Worker WASM Radix Sort\n(백그라운드 멀티스레드 정렬)"]
        GPU["WebGL2 Float Texture 버퍼 바인딩\n& 인스턴스 래스터라이제이션"]
        TScene["Three.js 씬 그래프\n(가상 공간 바닥 그리드, 조명)"]
    end

    subgraph Interaction["3. WebXR 6DoF 인터랙션"]
        WXR["WebXRManager\n(Stereo Camera Rig, 6DoF Controllers)"]
        XRIM["XRInteractionManager\n(텔레포트, 부드러운 보행, 양손 스케일/회전)"]
        UI["OverlayUI & GPU Tuning HUD\n(입자 크기, 투명도 실시간 조절)"]
    end

    PLY --> SM
    SM <--> WASM
    SM --> GPU
    GPU <--> TScene
    TScene <--> WXR
    WXR --> XRIM
    SM <--> UI
```

* **하이브리드 합성 렌더링 루프**:
  가우시안 스플랫 메쉬와 Three.js의 가상 3D 객체를 동일한 WebGL 렌더 타겟에 깊이 버퍼 정합을 유지하며 합성 렌더링.
* **스테레오 렌더 루프 분기**:
  PC 단일 뷰포트(`requestAnimationFrame`) 모드와 WebXR 스테레오 좌/우안(`setAnimationLoop`) 렌더 루프를 매끄럽게 전환.

---

## 4. 핵심 트러블슈팅 및 최적화

### 1) 모바일 HMD(Meta Quest)를 위한 GPU 연산 부하 최적화
* **문제 현상**:
  - Meta Quest의 모바일 프로세서는 반투명 입자가 여러 겹 겹치는 화면 덧칠 연산에 취약하여, 양안 VR 렌더링 시 프레임이 45fps 이하로 급락하는 현상 발생.
* **해결 방법**:
  - **투명 가우시안 계산 제외 (Alpha Cutoff)**: 형태에 거의 영향을 주지 않는 흐릿하고 투명한 입자들을 렌더링 계산에서 미리 제외하여 연산량을 30% 이상 절감.
  - **입자 크기 미세 조절 (Splat Scale)**: 개별 입자의 크기를 살짝 줄여 입자들끼리 겹치는 면적을 줄이고 그래픽 메모리 대역폭 부담을 완화.
  - **실시간 GPU 튜닝 패널**: 새로고침 없이 화면에서 입자 크기, 투명도 컷오프, 점군(Point Cloud) 모드를 즉시 조절하며 최적의 프레임을 찾을 수 있는 UI 구축.

| 실시간 GPU 렌더 튜닝 & 최적화 HUD 패널 |
| :---: |
| ![GPU Tuning HUD](docs/images/gpu_tuning_hud.png) |

### 2) 백그라운드 멀티스레드 정렬과 WebXR 스테레오 루프 통합
* **문제 현상**:
  - 수십만 개 입자의 앞뒤 순서를 정렬하는 무거운 연산을 웹 브라우저 메인 스레드에서 돌리면 화면 멈춤이 발생하고, 브라우저 보안 규정상 백그라운드 멀티스레드(`SharedArrayBuffer`) 사용이 기본 차단되어 있음.
* **해결 방법**:
  - Vite 서버에 필수 보안 격리 헤더(COOP/COEP)를 설정하여, 백그라운드 워커(Web Worker)에서 고속 정렬 알고리즘(WASM Radix Sort)이 독립적으로 돌도록 멀티스레딩 파이프라인을 활성화.
  - PC 화면과 VR 헤드셋 양안 화면의 렌더링 주기를 매끄럽게 전환하여, 끊김 없이 안정적인 60~90 FPS를 유지.

---

## 5. 조작 가이드

### 데스크톱 웹 환경
| 입력 | 동작 |
| :--- | :--- |
| **마우스 좌클릭 드래그** | 씬 360° 궤도 회전 |
| **마우스 우클릭 드래그** | 카메라 이동 |
| **마우스 휠 스크롤** | 카메라 확대 / 축소 |
| **상단 드롭다운 / 파일 열기** | 프리셋 모델 전환 (`Bonsai`, `Dragon`) 및 로컬 3DGS 파일 로드 |
| **우측 상단 튜닝 버튼** | GPU 실시간 렌더 튜닝 드로어 패널 토글 |

### Meta Quest 환경
| 컨트롤러 입력 | 동작 |
| :--- | :--- |
| **왼손 썸스틱** | 부드러운 전후좌우 보행 이동 |
| **오른손 썸스틱** | 45° 스냅 회전 |
| **오른손 트리거 (길게 누름)** | 바닥 포물선 궤적 텔레포트 |
| **양손 그립 버튼** | 공간 전체 확대/축소 및 자유 회전 |

---

## 6. 로컬 실행 가이드

본 프로젝트는 특정 네트워크망이나 외부 백엔드 서버에 의존하지 않는 **100% 독립형 SPA** 구조로 제작되었습니다.

### 1) 의존성 설치
```bash
npm install
```

### 2) 개발 서버 실행
```bash
npm run dev
```
- 서버가 실행되면 로컬 네트워크 IPv4가 자동 탐지되어 터미널에 출력됩니다:
  ```
  ➜  Local:   https://localhost:5173/
  ➜  Network: https://<현재-PC-IP>:5173/
  ```

### 3) 프로덕션 빌드
```bash
npm run build
```
- 빌드 결과물은 `dist/` 디렉토리에 정적 파일로 생성되며, Vercel / Netlify / GitHub Pages 등에 즉시 배포할 수 있습니다.

---

## 7. Meta Quest 접속 가이드

1. **동일한 로컬 네트워크(Wi-Fi) 연결**:
   - 서버를 구동 중인 PC와 Meta Quest 헤드셋이 **반드시 같은 공유기(Wi-Fi)**에 연결되어 있어야 합니다.
2. **Quest 브라우저에서 접속**:
   - 헤드셋을 착용하고 오큘러스 브라우저 주소창에 터미널에 출력된 IP 주소를 입력합니다:
     ```
     https://<PC_로컬_IP>:5173
     ```
3. **자체 서명 SSL 인증서 승인 (최초 1회 필수)**:
   - WebXR 구동을 위해서는 HTTPS 보안 컨텍스트가 필수입니다.
   - 첫 접속 시 *"연결이 비공개로 설정되어 있지 않습니다"* 경고가 표시될 경우, 화면 하단의 **[고급(Advanced)]** 클릭 후 **[<PC_IP> (안전하지 않음)으로 이동]**을 선택하여 승인합니다.
4. **VR 진입**:
   - 화면 우측 상단의 **`ENTER VR`** 버튼을 클릭하여 몰입형 3DGS 6DoF 세션으로 진입합니다.

---

## 8. 외부 에셋 라이선스

프로젝트에 활용된 3DGS 에셋은 연구 및 교육 목적의 공공 벤치마크 데이터셋입니다:

* **Bonsai Tree Scene (`.ksplat`)**:
  - **출처**: [Mip-NeRF 360 Dataset](https://jonbarron.info/mipnerf360/) (Barron et al., CVPR 2022) 및 [3D Gaussian Splatting](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/) (Kerbl et al., SIGGRAPH 2023)
  - **라이선스**: 연구 및 비상업적 교육용 (Non-Commercial Research)
* **Golden Dragon Scene (`.splat`)**:
  - **출처**: [Stanford 3D Scanning Repository](http://graphics.stanford.edu/data/3Dscanrep/) (Stanford Computer Graphics Laboratory)
  - **라이선스**: 연구 및 교육용 (Research & Educational Use)

---

## Author & Contact

* **개발자**: 김호현
* **GitHub**: [kimhohyeon0324](https://github.com/kimhohyeon0324)
* **저장소 링크**: [WebXR-3DGS-Viewer](https://github.com/kimhohyeon0324/WebXR-3DGS-Viewer)
* **License**: MIT

