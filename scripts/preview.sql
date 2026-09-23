-- Synthetic local preview fixtures only. Never execute against a production database.
INSERT INTO analyses(id,repo,number,title,body,decision) VALUES('7bf3867c7b2762ecf1b8fb0990454928439c02021b9b4c2fc1e158293f3325b2','example/demo',101,'【演示】切换筛选条件后，列表显示旧结果','模拟报告，仅用于本地界面预览。

问题：切换筛选条件后，列表仍显示之前的结果。
环境：示例项目 1.2，测试浏览器。
预期：结果与当前筛选条件一致。','{"category": {"choice": "bug", "confidence": 0.87}, "module": {"choice": "frontend", "confidence": 0.78}, "missing": ["reproduction"], "labels": ["bug", "needs-info"], "completeness": {"reproduction": 0.1, "version": 0.8, "expected": 0.9}, "model": "synthetic-preview", "inputTokens": 0}') ON CONFLICT(id) DO NOTHING;
INSERT INTO analyses(id,repo,number,title,body,decision) VALUES('c7e7958e3516f06472be151c3bac53428b9da63849c93e6cab81aff92b245154','example/demo',102,'【演示】支持批量导出选中的记录','模拟功能建议，仅用于本地预览。

希望把选择的记录导出为 CSV，用于离线整理。','{"category": {"choice": "enhancement", "confidence": 0.92}, "module": {"choice": "frontend", "confidence": 0.78}, "missing": [], "labels": ["enhancement"], "completeness": {"reproduction": 0.1, "version": 0.8, "expected": 0.9}, "model": "synthetic-preview", "inputTokens": 0}') ON CONFLICT(id) DO NOTHING;
INSERT INTO analyses(id,repo,number,title,body,decision) VALUES('9349cb8ba9bed3fd194a8846bbce10d6961436a6fa3c0389165303ee008e351d','example/demo',103,'【演示】补充本地启动的环境变量说明','模拟文档反馈，仅用于本地预览。

目前不知道哪些环境变量是必填项，希望增加一份示例配置。','{"category": {"choice": "documentation", "confidence": 0.89}, "module": {"choice": "tooling", "confidence": 0.78}, "missing": [], "labels": ["documentation"], "completeness": {"reproduction": 0.1, "version": 0.8, "expected": 0.9}, "model": "synthetic-preview", "inputTokens": 0}') ON CONFLICT(id) DO NOTHING;
