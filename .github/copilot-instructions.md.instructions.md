
## Coding Standards

- Always use single quotes for strings and imports in TS or JS.
- Always use `const` for variables that are not reassigned.
- Provide meaningful comments for anything that is not self-explanatory.

## src/ Structure

- `cli/`: wrappers for CLI commands. Subclass `EnvironmentCmd` for new ones.
- `commands/`: VS Code commands wrapped in classes and logically grouped. Subclass `Commands`.
- `decorators/`: decorators for commands and other utilities.
- `views/`: VS Code tree/views.
- `util.ts`: utility methods / extensions.
