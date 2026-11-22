# UTM MONITORING & TACTICAL DECONFLICTION SYSTEM (TASKS 10, 11, 12 & 13)

Kết nối kế hoạch bay từ UTM Ops: [Hướng dẫn cấu hình và kiểm tra](UTM_OPS_INTEGRATION.md).
> **Đồ án nghiên cứu**: Hệ thống UTM tích hợp AI hỗ trợ phát hiện, giám sát thời gian thực 3D và giảm thiểu xung đột chiến thuật cho UAV trong khu vực Đà Nẵng.  
> **Các nhiệm vụ đảm nhiệm**:
> - **Task 10 (Phần 4)**: Giám sát thời gian thực và tái dựng không gian 3D Đà Nẵng (React + TypeScript + CesiumJS).
> - **Task 11 (Phần 5)**: Mô-đun phát hiện, dự báo quỹ đạo và xử lý xung đột chiến thuật tích hợp AI (Python + FastAPI).
> - **Task 12 (Phần 6)**: Giao thức kết nối, hợp đồng dữ liệu liên thành phần và phân quyền an toàn.
> - **Task 13**: Luồng tích hợp và 4 kịch bản kiểm thử mẫu (Normal, Pre-flight mock, Weather dynamic, Data source swap).

---

## 1. Kiến trúc Hệ thống Tổng thể

```
+-----------------------------------------------------------------------------------+
|                        TASK 10: UTM MONITORING (PORT 3000)                        |
|                                                                                   |
|  - Bản đồ 3D CesiumJS Đà Nẵng, Vệt bay thực tế, Vùng cấm bay 3D (NFZ).            |
|  - Tiếp nhận Telemetry đa nguồn: DemoDataSource, Live WS, Import JSON Phước.       |
|  - Bộ lọc kiểm tra tính toàn vẹn và đánh giá độ mới (Validator & Synchronizer).  |
|  - Cầu nối trích xuất dữ liệu quan sát sạch: Part5ExportBridge.                   |
|  - Giao diện Chiến thuật: Xem trước 3D, Duyệt / Từ chối phương án, Chế độ AI.     |
+--------------------------------------------------------------------+--------------+
                                                                     |
                                        REST POST /api/tactical/feed | WebSocket
                                                                     v
+-----------------------------------------------------------------------------------+
|                   TASK 11: TACTICAL DECONFLICTION ENGINE (PORT 8000)              |
|                                                                                   |
|  - Python 3.13 + FastAPI + Pydantic v2 + Scikit-Learn.                            |
|  - Thuật toán 3D CPA (Closest Point of Approach) & Phân cách địa lý ENU/WGS84.     |
|  - Phân biệt giao cắt hình học và xung đột thời gian thực (Temporal separation). |
|  - Bộ kiểm tra 7 ràng buộc an toàn (Primary, Secondary N>=3, NFZ, Dynamics...).   |
|  - Tầng A (Quy tắc cơ sở) & Tầng B (AI hỗ trợ xếp hạng đặc trưng - AI Ranker).    |
|  - State Machine 11 bước (DETECTED -> ... -> APPROVED -> EXECUTING -> VERIFIED).  |
|  - MockExecutionAdapter & LiveExecutionAdapter.                                   |
|  - Xuất báo cáo sự cố định dạng chuẩn JSON và CSV.                                |
+-----------------------------------------------------------------------------------+
```

---

## 2. Công nghệ Sử dụng

- **Frontend (Task 10 & UI Chiến thuật)**: React 19, TypeScript 5, CesiumJS 1.146, Vite 8, Zustand, Tailwind CSS v4, Lucide Icons.
- **Backend (Task 11 Chiến thuật)**: Python 3.13, FastAPI, Uvicorn, Pydantic v2, NumPy, SciPy, Scikit-Learn.
- **Automated Testing**:
  - `vitest`: 31/31 unit & integration tests passed.
  - `pytest`: 16/16 tactical deconfliction scenarios passed.
  - **Tổng cộng: 47/47 bài kiểm thử tự động đạt 100%**.

---

## 3. Hướng dẫn Khởi chạy Hệ thống

### 3.1. Khởi chạy Backend FastAPI (Task 11)
```bash
# Mở terminal thứ nhất:
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload

# Kiểm tra trạng thái: http://127.0.0.1:8000/api/tactical/health
# Tài liệu Swagger API: http://127.0.0.1:8000/docs
```

### 3.2. Khởi chạy Frontend React (Task 10 & Tích hợp)
```bash
# Mở terminal thứ hai:
npm run dev -- --host 127.0.0.1 --port 3000

# Truy cập ứng dụng tại: http://127.0.0.1:3000
```

---

## 4. Hướng dẫn Chạy Kiểm thử Toàn bộ

```bash
# 1. Chạy 16 bài kiểm thử giải thuật xung đột chiến thuật (Pytest Backend)
python -m pytest backend/tests/ -v

# 2. Chạy 31 bài kiểm thử frontend, adapter Phước và luồng tích hợp (Vitest Frontend)
npx vitest run

# 3. Kiểm thử đóng gói sản xuất (Production Build)
npm run build
```

---

## 5. Tài liệu Chuyên sâu

- [TASK11_TACTICAL_DESIGN.md](file:///d:/Nghien%20cuu%20khoa%20hoc/TASK11_TACTICAL_DESIGN.md): Thiết kế giải thuật CPA, mô hình động học, 7 tiêu chí kiểm tra ràng buộc, lưu đồ xử lý và cơ chế AI xếp hạng.
- [TASK12_DATA_CONTRACT.md](file:///d:/Nghien%20cuu%20khoa%20hoc/TASK12_DATA_CONTRACT.md): Danh mục 12 loại bản tin chuẩn hóa, schema JSON, phân quyền RBAC và giả định bảo mật.
- [TASK13_INTEGRATION_SCENARIOS.md](file:///d:/Nghien%20cuu%20khoa%20hoc/TASK13_INTEGRATION_SCENARIOS.md): Mô tả chi tiết 4 kịch bản tích hợp và ranh giới phân định với Huy (Part 3) và Phước (Part 2).
- [TEST_RESULTS.md](file:///d:/Nghien%20cuu%20khoa%20hoc/TEST_RESULTS.md): Chi tiết kết quả thực tế của 47 test case, build time và bằng chứng trình duyệt thực tế.
