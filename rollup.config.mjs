import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import babel from "@rollup/plugin-babel";

const plugins = [
    nodeResolve(),
    commonjs(),
    babel()
];

export default [
    {
        input: "src/main.js",
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
        plugins
    },
    {
        input: "src/file-storage-main.js",
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
        plugins
    },
    {
        input: "awp/ennuicastr-worker.js",
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
        plugins
    }
];
