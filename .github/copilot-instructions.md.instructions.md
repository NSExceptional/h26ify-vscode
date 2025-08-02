
## Coding Standards

- Always use single quotes for strings and imports in TS or JS.
- Always use `const` for variables that are not reassigned.
- Provide meaningful comments for anything that is not self-explanatory.
- When adding doc comments to methods, don't document obvious parameters and return values.

## src/ Structure

- `cli/`: wrappers for CLI commands. Subclass `EnvironmentCmd` for new ones.
- `commands/`: VS Code commands wrapped in classes and logically grouped. Subclass `Commands`.
- `decorators/`: decorators for commands and other utilities.
- `views/`: VS Code tree/views.
- `util.ts`: utility methods / extensions.

## Project Quirks and Preferences

- Unless otherwise specified, simply throw an error instead of using `window.showErrorMessage()` or `console.error()`.
- Similarly, avoid `catch`ing and modifying/repackaging a thrown error.
- Prefer stringy union types to enums, and prefer `switch`ing on them to using `if` for checking them.
