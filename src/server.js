const express = require('express');
const app = express();
const PORT = 3000;

// Main Route 
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="pl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Cluster Cost Explorer</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    height: 100vh;
                    margin: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    text-align: center;
                }
                .card {
                    background: rgba(255, 255, 255, 0.1);
                    padding: 3rem;
                    border-radius: 15px;
                    backdrop-filter: blur(10px);
                    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
                }
                h1 { margin: 0 0 10px 0; font-size: 3rem; }
                p { margin: 0; opacity: 0.8; font-size: 1.2rem; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Kubernetes Cluster Cost Explorer Application</h1>
                <p>Template</p>
            </div>
        </body>
        </html>
    `);
});

// Running the Server
app.listen(PORT, () => {
    console.log(`Serwer działa na http://localhost:${PORT}`);
});
