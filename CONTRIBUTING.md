# 参与开发

欢迎提交界面改进、数据问题、使用文档和测试。请在**本工作台仓库**的 Issues 中检索已有讨论。开新问题时，注明工作台标签或提交号、操作系统、Python 版本，以及最短的复现步骤。浏览器问题请加上浏览器版本。截图和日志请隐去凭证、持仓及私人报告。

## 在本机验证修改

按[快速入门](docs/QUICKSTART.md)创建并激活 Python 虚拟环境。在仓库根目录安装开发依赖后运行以下命令。默认 Python 测试可在无模型密钥的环境中执行。

```sh
python -m pip install -e ".[dev]"
python -m pytest -q
ruff check .
```

修改前端报告展示时，用 Node.js 24 运行解析测试。需要在浏览器预览时，运行 `tradingagents-web --open`。

```sh
node --test tests/test_web_report.mjs
```

工作台服务和静态页面位于 `tradingagents/web/`，工作台测试位于 `tests/test_web_*`。新增第三方代码或素材时，随改动注明来源和许可证并保留原有声明。项目沿用上游 Apache-2.0 许可证。[来源与署名](ATTRIBUTION.md) · [项目许可证](LICENSE)

## 提交 Pull Request

从本仓库默认分支创建工作分支。PR 的目标仓库请选择本工作台，正文写明要解决的问题、改动内容及已运行的检查。涉及交互变化时，附上使用示例数据的截图，帮助维护者复现。
