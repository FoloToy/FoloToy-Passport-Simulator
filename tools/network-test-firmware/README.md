# 网络检查固件

`network-test.bin` 是 `tools/verify-network.mjs` 使用的 ESP32-C3 Full Flash 镜像，
由 ESP-IDF v5.5.3 的 `examples/protocols/http_request` 示例编译而成。它连接开放网络
`Emulator Host Bridge`，通过 DHCP 获取地址后循环请求 `http://example.com/`。

配置见 `sdkconfig.defaults`。导出 ESP-IDF v5.5 环境后执行以下命令即可重新生成：

```bash
tools/network-test-firmware/build.sh
```
