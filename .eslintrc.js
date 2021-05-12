module.exports = {
    root: true,
    parser: "@typescript-eslint/parser",
    plugins: [
        "@typescript-eslint"
    ],
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended"
    ],
    overrides: [
        {
            files: ["*.ts"],
            rules: {
                "@typescript-eslint/no-explicit-any": "off",
                "no-empty": "off",
                "prefer-spread": "off"
            }
        }
    ]
};
