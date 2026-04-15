import { fileURLToPath, URL } from "node:url";

import nodePolyfills from "@rolldown/plugin-node-polyfills";
import { configDefaults, defineConfig } from "vite-plus";

export default defineConfig({
    resolve: {
        alias: {
            "@export": fileURLToPath(new URL("./src/export", import.meta.url)),
            "@file": fileURLToPath(new URL("./src/file", import.meta.url)),
            "@util": fileURLToPath(new URL("./src/util", import.meta.url)),
            tests: fileURLToPath(new URL("./src/tests", import.meta.url)),
        },
    },
    pack: {
        entry: ["src/index.ts"],
        format: ["esm", "cjs", "iife", "umd"],
        globalName: "docx",
        plugins: [nodePolyfills()],
    },
    fmt: {
        sortImports: {
            type: "natural",
        },
        sortPackageJson: true,
        sortTailwindcss: {},
    },
    lint: {
        ignorePatterns: ["**/scripts/**", "**/dist/**", "**/coverage/**"],
        options: {
            typeAware: true,
            typeCheck: true,
        },
        rules: {
            "no-redundant-type-constituents": "off",
            "no-unused-expressions": "off",
        },
    },
    staged: {
        "*": "vp check --fix",
    },
    test: {
        coverage: {
            exclude: [
                ...configDefaults.exclude,
                "**/dist/**",
                "**/demo/**",
                "**/docs/**",
                "**/scripts/**",
                "**/src/**/index.ts",
                "**/src/**/types.ts",
                "**/src/util/output-type.ts",
                "**/*.spec.ts",
            ],
            provider: "v8",
            reporter: ["text", "json", "html"],
            thresholds: {
                branches: 99.68,
                functions: 100,
                lines: 100,
                statements: 100,
            },
        },
        environment: "happy-dom",
        exclude: [
            ...configDefaults.exclude,
            "**/build/**",
            "**/demo/**",
            "**/docs/**",
            "**/scripts/**",
        ],
        include: ["**/src/**/*.spec.ts", "**/packages/**/*.spec.ts"],
    },
});
