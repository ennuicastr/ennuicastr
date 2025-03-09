import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

const plugins = [
    nodeResolve({
        browser: true
    }),
    commonjs(),
    terser({format:{semicolons:false}})
];

export default [
    {
        input: "src/workers/waveform-worker.ts",
        output: {
            file: "dist/waveform-worker.js",
            format: "iife",
            name: "EnnuicastrWaveformWorker"
        },
        plugins: [
            typescript({
                exclude: ["src/*.ts"],
                compilerOptions: {
                    lib: ["es2021", "webworker"]
                }
            })
        ].concat(plugins)
    }
];
