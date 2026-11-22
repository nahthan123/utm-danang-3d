# Kết nối UTM Ops với giám sát 3D

Hai ứng dụng chạy riêng; không cần merge nhánh Git để gửi dữ liệu.

```text
UTM Ops :8080 -> outbox -> HTTP POST -> backend 3D :8000 -> WebSocket -> giao diện 3D :3000
UAV / bộ mô phỏng -------------------- WebSocket telemetry ----------> giao diện 3D
```

Ops gửi `flightplan.accepted` sau khi duyệt, `flightplan.status.changed` khi
ACTIVE/COMPLETED, `flightplan.cancelled` khi hủy kế hoạch đã duyệt. Payload giữ
hợp đồng `schemaVersion=1.0` của Ops. Endpoint nhận:
`POST /api/integration/flight-plans`, header `X-UTM-Integration-Key`.

## Chạy trên máy hiện tại

1. Ở `D:\NCKH\3D\utm-danang-3d`, sao chép `.env.example` thành `.env.local`.
   Thay `UTM_MONITORING_TOKEN` bằng khóa riêng ít nhất 16 ký tự; dùng cùng khóa
   ở Ops. Không đặt khóa vào biến `VITE_` vì các biến đó được đưa vào trình duyệt.

2. Chạy backend nhận kế hoạch (PowerShell, tại thư mục 3D):

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
   .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --env-file .env.local
   ```

3. Thêm các dòng sau vào `D:\NCKH\UTM\utm-ops-mvp\application-local.properties`,
   giữ nguyên cấu hình database đang có:

   ```properties
   utm.integration.mode=http
   utm.integration.monitoring-url=http://127.0.0.1:8000/api/integration/flight-plans
   utm.integration.monitoring-token=<cung-khoa-rieng-trong-env-local>
   ```

   Khởi động lại UTM Ops như bình thường. Mặc định của mã nguồn vẫn là `mock`;
   phải bật `http` để gửi thật. Có thể dùng biến môi trường `UTM_INTEGRATION_MODE`,
   `UTM_MONITORING_URL`, `UTM_MONITORING_TOKEN` thay cho cấu hình local.

4. Chạy frontend tại thư mục 3D: `npm ci`, sau đó `npm run dev`.
   Mở `http://localhost:3000`, chọn **LIVE**. Trong Cấu hình có hai địa chỉ riêng:
   nguồn vị trí UAV và nguồn kế hoạch `ws://localhost:8000/ws/flight-plans`.

5. Nộp rồi duyệt một chuyến bay trong Ops. Sau khoảng 3 giây, mục **Tích hợp**
   phải hiển thị MONITORING **Giám sát đã nhận** (`DELIVERED`), có receipt đúng
   eventId. Bên 3D xuất hiện thẻ **Kế hoạch UTM Ops** và đường bay đã duyệt.
   Bấm thẻ kế hoạch để đưa camera tới tuyến bay.

Nếu cần mô phỏng vị trí để kiểm tra hiển thị, có thể chạy ở terminal khác:

```powershell
.\.venv\Scripts\python.exe -m uvicorn mock_px4_ws_server:app --host 127.0.0.1 --port 8001
```

Nguồn mock có sẵn dùng ID riêng, chưa tự bay theo kế hoạch Ops. Để giám sát độ
lệch tuyến thật, bên mô phỏng/UAV cần phát bản tin nội bộ với `uav_id` bằng
`flightPlan.droneId` (UUID Ops) và `flight_plan_id` bằng `flightPlan.flightId`.
Nếu dùng adapter Phước, trường tương ứng là `flightPlanId`, còn ID UAV vẫn phải
là UUID Ops. Không tự liên kết bằng tên hoặc thứ tự UAV.

## Dữ liệu và xử lý lỗi

- Kế hoạch giữ UUID chuyến bay, UUID UAV, số sê-ri, thời gian và waypoint WGS84.
  Độ cao AGL/MSL/WGS84 giữ nguyên; dữ liệu cũ AMSL được gọi là MSL, không đổi số.
  Khi telemetry và kế hoạch dùng mốc độ cao khác nhau, không tính độ lệch 4D.
- Các ngưỡng giám sát mặc định là ngang 50 m, dọc 15 m, thời gian 10 s; đây là
  cấu hình so sánh của 3D, không phải xác nhận hành lang đã được cấp phép.
- Kế hoạch không tạo ra vị trí UAV hay dữ liệu đã quan sát. Chưa có telemetry
  liên kết thì thẻ ghi rõ trạng thái đó. Chỉ dữ liệu telemetry mới tạo UAV chuyển
  động và được dùng cho giám sát thời gian thực.
- Sau khi transaction duyệt đã commit, worker gửi tối đa 20 bản tin mỗi đợt,
  mặc định 3 giây/đợt, tối đa 5 lần mỗi bản tin. Lỗi kết nối hoặc ACK sai ghi
  `FAILED`; ADMIN có thể bấm **Gửi lại**. Không ảnh hưởng kết quả phê duyệt.
- Bản tin trạng thái cũ bị bỏ qua (`SUPERSEDED`). Cả cập nhật ACTIVE/COMPLETED và
  hủy đều chứa đầy đủ lộ trình, nên phía nhận không cần đã nhận bản duyệt trước.
- Cùng eventId được chống lặp; cùng ID nhưng nội dung khác trả 409. Bản tin trễ
  không làm lùi trạng thái hay hồi sinh chuyến đã hủy/hoàn thành.
- Backend lưu bền vững tại `data/monitoring.sqlite3`, có thể đổi bằng biến
  `UTM_MONITORING_DB`. WebSocket gửi snapshot khi mở trang/kết nối lại. Chạy một
  process backend (`uvicorn` mặc định 1 worker) để mọi kết nối nhận cùng broadcast.
- Bản ghi mock cũ không tự chuyển thành đã gửi thật. ADMIN có thể gửi lại bản
  MONITORING của kế hoạch APPROVED còn hiệu lực. SIMULATION giữ PENDING trong
  chế độ http; phần bàn giao cho mô phỏng chưa được triển khai trong kết nối này.
- UTM Ops dùng 8080. Nếu dùng `telemetry_relay.py` cũ (cũng dùng 8080), cần bố
  trí cổng khác trước khi chạy đồng thời. Backend 3D ở 8000 và ví dụ mock ở 8001.
- Khi chạy trên hai máy, đổi địa chỉ loopback thành IP máy backend 3D ở cả Ops
  và Cấu hình 3D. URL WebSocket phải truy cập được từ máy chạy trình duyệt.

## Kiểm thử

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npx vitest run
npm run build
```

Các kiểm thử frontend chiến thuật cần backend `:8000` đang chạy. Kiểm thử handoff
dùng database tạm, không chỉnh dữ liệu chuyến bay trong Ops đang sử dụng.

Kiểm thử hai backend thực tế: đóng gói Ops bằng `mvnw.cmd package`, rồi chạy tại
thư mục 3D:

```powershell
.\.venv\Scripts\python.exe scripts/verify_ops_handoff.py --ops-jar D:\NCKH\UTM\utm-ops-mvp\target\utm-flight-registration-0.1.0.jar --java 'C:\Program Files\Eclipse Adoptium\jdk-25.0.1.8-hotspot\bin\java.exe'
```

Script dùng cổng trống, H2 trong bộ nhớ, SQLite tạm và tài khoản kiểm thử riêng;
kiểm tra duyệt, receipt HTTP, cập nhật WebSocket, hủy, gửi lặp và snapshot khi kết
nối lại. Tự dừng các tiến trình do script tạo sau kiểm thử.
