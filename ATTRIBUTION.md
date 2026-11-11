# 项目来源与署名

## 谁在做这个项目

| 角色 | 人员与贡献 |
| --- | --- |
| Web GUI 发起与维护 | @FlyingAngeryBird 负责这个独立社区版本的产品方向、发布和维护。Web 界面开发使用了 Codex 辅助。[维护者主页](https://github.com/FlyingAngeryBird) |
| 上游研究框架 | Tauric Research 与 TradingAgents 的开源贡献者开发了研究智能体、工作流、数据接口和命令行工具。[上游仓库](https://github.com/TauricResearch/TradingAgents) · [贡献记录](https://github.com/TauricResearch/TradingAgents/graphs/contributors) |
| 上游论文作者 | Yijia Xiao、Edward Sun、Di Luo 和 Wei Wang 撰写了 *TradingAgents: Multi-Agents LLM Financial Trading Framework*，首发于 2024 年。引用其多智能体研究方法时，请引用原论文。[arXiv:2412.20138](https://arxiv.org/abs/2412.20138) |

## 代码从哪里来

本项目从 TauricResearch/TradingAgents 的提交 `9fa1196fffbcfd9de5146d2dd2869df84ab99838` 派生。这是上游 `v0.7.1` 之后的第一个提交。该基线提供行情和新闻等数据接口、LangGraph 研究流程、多空辩论、风险评估、历史回测、决策记忆、报告生成以及 CLI。[上游基线源码](https://github.com/TauricResearch/TradingAgents/tree/9fa1196fffbcfd9de5146d2dd2869df84ab99838)

本社区版本增加了以下内容。

- **浏览器工作台。** 中文界面提供标的分析与历史回测表单、任务进度、历史报告和决策记忆浏览。页面通过本地服务访问同一套研究引擎。[前端源码](tradingagents/web/static/)
- **本地任务与配置。** 服务端启动研究任务、记录任务状态和步骤，向页面提供报告与配置接口。用户可以在工作台中选择模型、设置数据源并管理凭据。[后端源码](tradingagents/web/)
- **安装与测试。** Python 包增加 `tradingagents-web` 入口，随包分发 Web 静态资源。工作台另有覆盖任务、进度、设置、服务端和报告呈现的测试。[包配置](pyproject.toml) · [测试](tests/)

## 许可证与品牌

项目保留了上游完整的 Apache License 2.0，Web GUI 源码同样按 Apache-2.0 提供。再分发源码或构建产物时，应随附许可证，保留适用的版权、专利、商标和署名声明，并在修改过的文件中明显标明修改。若所分发的上游版本包含 `NOTICE`，还应按第 4(d) 条保留其中适用的署名。此处记录的上游基线没有单独的 `NOTICE` 文件。[本仓库许可证](LICENSE) · [Apache-2.0 第 4 条](https://www.apache.org/licenses/LICENSE-2.0)

上游文档插图及 CLI 截图位于 `assets/`。其中的 `TauricResearch.png` 和原版 HTML 报告使用的 `tradingagents/assets/tauric-logo.svg` 均随上游保留。Tauric Research 的名称和标志用于标明来源。品牌使用受 Apache-2.0 第 6 条约束。本 GUI 由上述社区维护者独立发布。[上游素材](https://github.com/TauricResearch/TradingAgents/tree/9fa1196fffbcfd9de5146d2dd2869df84ab99838/assets) · [Apache-2.0 第 6 条](https://www.apache.org/licenses/LICENSE-2.0)

## 依赖、数据与模型

安装时下载的 Python 库各自保留其许可证，包括 LangGraph、LangChain 集成、pandas 和 yfinance 等。分发包含这些库的镜像或安装包时，应按实际包含的版本附上适用的许可证和声明。[依赖表](pyproject.toml)

运行时获取的行情、新闻、社交内容及模型输出涉及独立的服务条款。在公开示例报告或商用前，应按来源核对展示、再分发及署名要求。例如，yfinance 提示使用者核对 Yahoo 数据的使用权限，FRED 的部分序列由第三方持有版权，Alpha Vantage 的商业使用适用单独约定。模型服务按所选提供商与账号的条款使用。[yfinance 数据使用说明](https://github.com/ranaroussi/yfinance#readme) · [FRED 服务条款](https://fred.stlouisfed.org/legal/) · [Alpha Vantage 服务条款](https://www.alphavantage.co/terms_of_service/)
