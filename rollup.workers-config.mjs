import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

const plugins = [
    typescript({
        exclude: ["src/*.ts"],
        compilerOptions: {
            lib: ["es2021", "webworker"]
        }
    }),
    nodeResolve({
        browser: true
    }),
    commonjs(),
    terser({format:{semicolons:false}})
];

function worker(name) {
    return {
        input: `src/workers/${name}-worker.ts`,
        output: {
            file: `dist/${name}-worker.js`,
            format: "iife",
            name: `Ennuicastr${name}Worker`
        },
        plugins
    };
}

export default [
    worker("encoder"),
    worker("inproc"),
    worker("outproc"),
    worker("waveform")
];
