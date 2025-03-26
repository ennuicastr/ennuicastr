import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";

const plugins = [
    typescript({
        exclude: ["src/workers/*"]
    }),
    nodeResolve({
        browser: true
    }),
    commonjs(),
    json()
];

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
        context: "window",
        plugins: plugins
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
        context: "window",
        plugins: plugins
    }
];
