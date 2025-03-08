import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";

const plugins = [
    nodeResolve({
        browser: true
    }),
    commonjs(),
    json()
];

const pluginsTS = [
    typescript({
        exclude: ["awp/*", "src/workers/*"]
    })
].concat(plugins);

const pluginsTSWorker = [
    typescript({
        exclude: ["src/*", "src/workers/*"],
        compilerOptions: {
            lib: ["es2017", "webworker"]
        }
    })
].concat(plugins);

const pluginTerser = terser({
    format: {
        semicolons: false
    }
});

export default [
    {
        input: "src/main.ts",
        output: [
            {
                file: "dist/ennuicastr.js",
                format: "umd",
                name: "Ennuicastr"
            },
            {
                file: "dist/ennuicastr.min.js",
                format: "umd",
                name: "Ennuicastr",
                plugins: [pluginTerser]
            }
        ],
        plugins: pluginsTS
    },
    {
        input: "src/file-storage-main.ts",
        output: [
            {
                file: "dist/fs/fs.js",
                format: "umd",
                name: "EnnuicastrFileStorage"
            },
            {
                file: "dist/fs/fs.min.js",
                format: "umd",
                name: "EnnuicastrFileStorage",
                plugins: [pluginTerser]
            }
        ],
        plugins: pluginsTS
    },
    {
        input: "awp/ennuicastr-worker.ts",
        output: [
            {
                file: "dist/awp/ennuicastr-worker.js",
                format: "iife",
                name: "EW"
            },
            {
                file: "dist/awp/ennuicastr-worker.min.js",
                format: "iife",
                name: "EW",
                plugins: [pluginTerser]
            }
        ],
        plugins: pluginsTSWorker
    }
];
