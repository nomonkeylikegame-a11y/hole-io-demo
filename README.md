# Pocket District

Game 3D chơi đơn bằng Cocos Creator 3.8.8. Điều khiển chiếc hố qua khu phố và nuốt đồ để tăng kích thước. Màn có **552 vật thể**, gồm **500 khối nhỏ** xếp thành 3 trụ tròn, 2 kim tự tháp và 3 trụ vuông. Trụ cao nhất có 10 tầng. Lướt dưới chân trụ để nuốt các khối dưới cùng và làm tầng trên hạ xuống.

## Chạy game

[Chơi trên GitHub Pages](https://nomonkeylikegame-a11y.github.io/hole-io-demo/)

1. Mở thư mục repo dưới dạng project có sẵn trong Cocos Dashboard và chọn **Cocos Creator 3.8.8**.
2. Mở `assets/PocketDistrict.scene` trong Assets, đợi Creator import tài nguyên, rồi bấm **Preview**. Cảnh dựng khu phố và giao diện khi bắt đầu chạy.
3. Dùng **WASD**, **phím mũi tên** hoặc **kéo** trên vùng chơi. **M** bật/tắt âm thanh, **R** chơi lại. Trên web, nhạc bắt đầu sau thao tác đầu tiên.

Để xuất Web Desktop hoặc Web Mobile, chọn nền tảng tương ứng trong **Project → Build** và dùng `PocketDistrict` làm cảnh khởi động.

## Cấu trúc MVC

- `DistrictRules.ts` chứa model TypeScript thuần với bố cục, chuyển động, cách nuốt vật và tiến độ vòng chơi.
- `DistrictView.ts` dựng khu phố, hoạt ảnh, camera và HUD bằng Cocos.
- `PocketDistrict.ts` là controller Cocos duy nhất. File nhận input, tải tài nguyên và chuyển kết quả từng khung hình từ model sang phần hiển thị và âm thanh.

`source-art/` chứa các model FBX gốc, gồm `block.fbx` dùng cho các trụ. Game dùng mesh đã bake từ bộ model, texture PNG tự tạo và âm thanh OGG/WAV trong `assets/resources/`. Nhạc nền *Side Street* là một bản loop nhẹ, đi cùng 7 hiệu ứng cho nuốt vật nhỏ/lớn, hụt, lên cấp, bật tiếng, chơi lại và hoàn thành.
