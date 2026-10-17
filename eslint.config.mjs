import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.vscode-test/**", ".claude/**", ".superpowers/**"] },
  ...tseslint.configs.recommended,
);
