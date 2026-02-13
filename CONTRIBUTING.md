# Contributing to OpenClaw Enterprise Gateway

Thank you for your interest in contributing to OpenClaw! We welcome contributions from the community.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and collaborative environment.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/your-org/openclaw/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - System information (OS, Node.js version, Docker version)
   - Logs or screenshots if applicable

### Suggesting Enhancements

1. Open an issue with the `enhancement` label
2. Describe the feature and its use case
3. Explain why this enhancement would be useful

### Pull Requests

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Make your changes**
   - Follow the code style guidelines
   - Write tests for new features
   - Update documentation as needed

4. **Commit your changes**
   ```bash
   git commit -m 'feat: add amazing feature'
   ```
   
   Use conventional commits:
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `style:` Code style changes (formatting, etc.)
   - `refactor:` Code refactoring
   - `test:` Adding or updating tests
   - `chore:` Maintenance tasks

5. **Push to your fork**
   ```bash
   git push origin feature/amazing-feature
   ```

6. **Open a Pull Request**
   - Provide a clear description of the changes
   - Reference any related issues
   - Ensure all tests pass
   - Wait for review

## Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/openclaw.git
cd openclaw

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Run tests
npm test

# Start in development mode
npm run dev
```

## Code Style

- Use TypeScript strict mode
- Follow ESLint rules (run `npm run lint`)
- Format code with Prettier (run `npm run format`)
- Write meaningful variable and function names
- Add JSDoc comments for public APIs

## Testing

- Write unit tests for all new features
- Maintain test coverage above 80%
- Run tests before submitting PR: `npm test`
- Run tests in watch mode during development: `npm run test:watch`

## Documentation

- Update README.md if adding new features
- Add JSDoc comments for public APIs
- Update docs/ folder for architectural changes
- Include inline comments for complex logic

## Review Process

1. Automated checks must pass (linting, tests, build)
2. At least one maintainer approval required
3. Address review feedback constructively
4. Squash commits before merging (if requested)

## Project Structure

Familiarize yourself with the project structure:
```
src/
├── cli/           # CLI commands
├── gateway/       # Core gateway logic
├── connectors/    # External integrations
├── intelligence/  # AI/LLM integration
├── security/      # Security layer
├── storage/       # Persistence layer
└── web-ui/        # Control dashboard
```

## Questions?

Feel free to:
- Open an issue with the `question` label
- Join our Discord community
- Email us at dev@openclaw.dev

Thank you for contributing! 🎉
