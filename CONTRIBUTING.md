# Contributing

Thanks for your interest in contributing! This document provides guidelines and instructions.

## Getting Started

### Prerequisites

- Node.js >= 22
- pnpm >= 8

### Setup

1. Fork and clone the repository
2. Install dependencies using [@antfu/ni](https://github.com/antfu/ni):

```bash
ni
```

3. Build all packages:

```bash
nr build
```

4. Start development mode:

```bash
nr dev
```

## Project Structure

```
packages/
└── cnfast/              # Library, CLI, tests, and benchmarks
```

## Development Workflow

### Running Tests

```bash
pnpm test
```

### Linting & Formatting

```bash
nr lint        # Check for lint errors
nr lint:fix    # Fix lint errors
nr format      # Format code with oxfmt
```

## Code Style

- **Use TypeScript interfaces** over types
- **Use arrow functions** over function declarations
- **Use kebab-case** for file names
- **Use descriptive variable names** - avoid shorthands or 1-2 character names
- **Avoid type casting** (`as`) unless absolutely necessary
- **Keep interfaces/types** at the global scope
- **Remove unused code** and follow DRY principles
- **Avoid comments** unless absolutely necessary

## Submitting Changes

### Creating a Pull Request

1. Create a new branch:

```bash
git checkout -b feat/your-feature-name
```

2. Make your changes and commit with a descriptive message:

```bash
git commit -m "feat: add new feature"
```

3. Push to your fork and open a pull request

### Commit Convention

We use conventional commits:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks
- `refactor:` - Code refactoring
- `test:` - Test additions or changes

### Adding a Changeset

For changes that affect published packages, add a changeset:

```bash
nr changeset
```

Follow the prompts to describe your changes. This helps maintain accurate changelogs.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
