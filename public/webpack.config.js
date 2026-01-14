const fs = require('fs');
const webpack = require('webpack');
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const Dotenv = require('dotenv-webpack');

module.exports = (env, argv) => {
    return ({
        stats: 'minimal', // Keep console output easy to read.
        entry: './src/index.ts', // Your program entry point

        // Your build destination
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'bundle.js'
        },

        // Config for your testing server
        devServer: {
            headers: {
                "Cross-Origin-Embedder-Policy": "require-corp",
                "Cross-Origin-Opener-Policy": "same-origin"
            },
            compress: true,
            static: {
                directory: path.join(__dirname, 'static'),
                watch: true,
            },
            client: {
                logging: "warn",
                overlay: {
                    errors: true,
                    warnings: false,
                },
                progress: true,
            },
            port: 5002, host: '0.0.0.0',
            https: false,
            setupMiddlewares: (middlewares, devServer) => {
                if (!devServer) {
                    throw new Error('webpack-dev-server is not defined');
                }

                devServer.app.post('/upload-plugin', (req, res) => {
                    const filename = req.headers['x-filename'];
                    if (!filename) {
                        res.status(400).send('Missing x-filename header');
                        return;
                    }

                    // Basic body parsing for raw text
                    let data = '';
                    req.setEncoding('utf8');
                    req.on('data', function(chunk) { 
                        data += chunk;
                    });
                    req.on('end', function() {
                        const targetPath = path.join(__dirname, 'src', 'DawiyPlugins', filename);
                        
                        // Security check: prevent directory traversal
                        if (!targetPath.startsWith(path.join(__dirname, 'src', 'DawiyPlugins'))) {
                            res.status(403).send('Invalid file path');
                            return;
                        }

                        fs.writeFile(targetPath, data, (err) => {
                            if (err) {
                                console.error('Error writing plugin file:', err);
                                res.status(500).send('Error saving plugin file');
                            } else {
                                console.log(`Plugin saved: ${targetPath}`);
                                res.status(200).send('Plugin saved successfully');
                            }
                        });
                    });
                });

                return middlewares;
            }
        },

        // Web games are bigger than pages, disable the warnings that our game is too big.
        performance: { hints: false },

        // Enable sourcemaps while debugging
        devtool: argv.mode === 'development' ? 'eval-source-map' : undefined,

        // Minify the code when making a final build
        optimization: {
            minimize: argv.mode === 'production',
            minimizer: [new TerserPlugin({
                terserOptions: {
                    ecma: 6,
                    compress: { drop_console: true },
                    output: { comments: false, beautify: false },
                },
            })],
        },


        // Explain webpack how to do Typescript
        module: {
            rules: [
                {
                    test: /\.ts(x)?$/,
                    loader: 'ts-loader',
                    exclude: /node_modules/
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader']
                }
            ]
        },
        resolve: {
            extensions: [
                '.tsx',
                '.ts',
                '.js',
                '.css',
            ]
        },

        plugins: [
            // Copy our static assets to the final build
            new CopyPlugin({
                patterns: [{ from: 'static/' }],
            }),

            // Make an index.html from the template
            new HtmlWebpackPlugin({
                template: 'src/index.html',
                hash: true,
                minify: false
            }),

            // Load environment variables from .env
            new Dotenv({
                path: './.env',
            })
        ]
    });
}