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
        exclude: ["awp/*"]
    })
].concat(plugins);

const pluginsTSWorker = [
    typescript({
        exclude: ["src/*"],
        compilerOptions: {
            lib: ["es2017", "webworker"]
        }
    })
].concat(plugins);

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
                plugins: [terser()]
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
                plugins: [terser()]
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
                plugins: [terser()]
            }
        ],
        plugins: pluginsTSWorker
    }
];
