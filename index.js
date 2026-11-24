'use strict';
// Vercel serverless entry — saari requests yahi aati hain (vercel.json rewrites).
const app = require('../app');
let ready = null;
module.exports = (req, res) => {
  if (!ready) ready = app.init();
  ready.then(() => app.handler(req, res)).catch(e => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Site start nahi ho payi: ' + e.message + '\n(Vercel me DATABASE_URL environment variable check karein — bina uske data nahi chalega.)');
  });
};
