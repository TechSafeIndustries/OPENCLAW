# 🦅 OpenClaw Enterprise Gateway

> **A persistent AI-powered orchestration gateway for autonomous engineering teams**

![Status](https://img.shields.io/badge/status-in%20development-yellow)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node.js](https://img.shields.io/badge/Node.js-20.x-green)
![Docker](https://img.shields.io/badge/Docker-ready-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 🎯 Overview

**OpenClaw Enterprise Gateway** is a CLI-based orchestrator and background service that acts as a persistent "Manager" agent, handling remote requests via WhatsApp/Telegram and intelligently routing technical tasks to local "Builder" agents.

### Key Features

- 🤖 **AI-Powered Intelligence**: Grounded in Google Cloud Gemini 3 Pro via Antigravity Auth Bridge
- 🔐 **Enterprise Security**: Secure secret management with vault-based encryption
- 💾 **Persistent Memory**: Thought Signatures for context retention across sessions
- ❤️ **Heartbeat Monitoring**: Real-time security auditing and health checks
- 🌐 **Multi-Channel**: WhatsApp & Telegram integration for remote task submission
- 🎛️ **Control UI**: Web-based dashboard for monitoring and management
- 🔗 **MCP Integration**: Model Context Protocol for BigQuery and AlloyDB access

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   OpenClaw Gateway                       │
│  ┌────────────────┐         ┌──────────────────┐        │
│  │ Manager Agent  │────────▶│  Builder Pool    │        │
│  │ (Orchestrator) │         │  (Task Executors)│        │
│  └────────────────┘         └──────────────────┘        │
│          │                           │                   │
│          ▼                           ▼                   │
│  ┌────────────────┐         ┌──────────────────┐        │
│  │ Thought        │         │  Heartbeat       │        │
│  │ Signatures     │         │  Monitor         │        │
│  └────────────────┘         └──────────────────┘        │
└──────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌──────────────────────┐
│ WhatsApp/       │          │ Gemini 3 Pro         │
│ Telegram        │          │ (Auth Bridge)        │
└─────────────────┘          └──────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌──────────────────────┐
│ MCP Services    │          │ BigQuery / AlloyDB   │
└─────────────────┘          └──────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 20.x or higher
- **Docker** with WSL2 support (Windows)
- **Git** for version control
- **Google Cloud Account** (for Gemini integration)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/openclaw.git
cd openclaw

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Configure your secrets
nano .env

# Build TypeScript
npm run build

# Run in development mode
npm run dev
```

### Docker Setup

```bash
# Build the container
docker-compose build

# Start the gateway
docker-compose up -d

# View logs
docker-compose logs -f gateway
```

---

## 📖 Usage

### CLI Commands

```bash
# Start the gateway service
openclaw start

# Stop the gateway service
openclaw stop

# Check service status
openclaw status

# View logs
openclaw logs --tail 100

# Manage configuration
openclaw config set <key> <value>
openclaw config get <key>
```

### Web Control UI

Access the control dashboard at `http://localhost:3000`

**Features:**
- Real-time task monitoring
- Agent pool visualization
- Heartbeat status dashboard
- Security audit logs
- Configuration management

---

## 🛠️ Development

### Project Structure

```
openclaw/
├── src/                    # Source code (TypeScript)
│   ├── cli/               # CLI interface
│   ├── gateway/           # Core gateway service
│   ├── connectors/        # WhatsApp/Telegram/MCP
│   ├── intelligence/      # Gemini integration
│   ├── security/          # Vault & encryption
│   ├── storage/           # Thought Signatures
│   └── web-ui/            # Control dashboard
├── docker/                # Docker configuration
├── config/                # Configuration files
├── tests/                 # Test suites
└── docs/                  # Documentation
```

### Available Scripts

```bash
npm run dev          # Start in development mode
npm run build        # Build TypeScript to JavaScript
npm run test         # Run test suite
npm run test:watch   # Run tests in watch mode
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run docker:build # Build Docker image
npm run docker:run   # Run Docker container
```

### Running Tests

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Coverage report
npm run test:coverage
```

---

## 🔐 Security

OpenClaw takes security seriously:

- **Vault-based Secrets**: All credentials encrypted at rest
- **Zero Trust**: Authentication required for all requests
- **Audit Logging**: Comprehensive security event tracking
- **Heartbeat Monitoring**: Continuous security health checks
- **Rate Limiting**: Protection against abuse

### Security Best Practices

1. Never commit `.env` files
2. Rotate secrets regularly
3. Review audit logs weekly
4. Keep dependencies updated
5. Enable 2FA for all accounts

---

## 📊 Monitoring

### Heartbeat Dashboard

The Heartbeat monitor provides:
- Service health status
- Agent pool utilization
- Task queue depth
- Memory/CPU metrics
- Security alerts

### Logging

Structured JSON logs with levels:
- `ERROR`: Critical failures
- `WARN`: Potential issues
- `INFO`: General information
- `DEBUG`: Detailed diagnostics

---

## 🌐 Integrations

### WhatsApp

```typescript
// Send task via WhatsApp
Send message to: +1234567890
Format: "TASK: Analyze codebase and suggest optimizations"
```

### Telegram

```typescript
// Send task via Telegram bot
@OpenClawBot task analyze codebase
```

### Gemini 3 Pro

```typescript
// Antigravity Auth Bridge configuration
export GEMINI_API_KEY="your-key-here"
export AUTH_BRIDGE_ENDPOINT="https://your-bridge.com"
```

### MCP Services

```typescript
// BigQuery & AlloyDB access via MCP
await mcpClient.query('SELECT * FROM tasks WHERE status = ?', ['pending']);
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Follow TypeScript best practices
- Use ESLint and Prettier
- Write tests for new features
- Document public APIs

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Antigravity Team**: Auth bridge and AI infrastructure
- **Google Cloud**: Gemini 3 Pro API
- **MCP Community**: Model Context Protocol specification
- **Open Source Contributors**: For the amazing tools we use

---

## 📞 Support

- **Documentation**: [docs/](./docs/)
- **Issues**: [GitHub Issues](https://github.com/your-org/openclaw/issues)
- **Discord**: [Join our community](https://discord.gg/openclaw)
- **Email**: support@openclaw.dev

---

## 🗺️ Roadmap

### Phase 1: Foundation ✅
- [x] Project scaffolding
- [x] Core architecture design
- [ ] CLI framework implementation

### Phase 2: Core Logic 🔄
- [ ] Manager Agent orchestration
- [ ] Builder Agent pool
- [ ] Thought Signatures storage

### Phase 3: Integrations ⏸️
- [ ] WhatsApp connector
- [ ] Telegram connector
- [ ] MCP integration
- [ ] Gemini integration

### Phase 4: UI ⏸️
- [ ] Web control dashboard
- [ ] Real-time monitoring
- [ ] Authentication system

### Phase 5: Production ⏸️
- [ ] Performance optimization
- [ ] Security hardening
- [ ] Deployment automation
- [ ] v1.0.0 release

---

**Built with ❤️ for autonomous engineering teams and Vibe Coders**

*Empowering your 24/7 digital workforce*
