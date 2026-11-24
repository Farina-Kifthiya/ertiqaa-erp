const express = require('express');
const path = require('path');
const config = require('./config');
const { errorHandler } = require('./middleware');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// security-ish headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/enquiries', require('./routes/enquiries'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/cases', require('./routes/cases'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/files', require('./routes/files'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/users', require('./routes/users'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/dashboard', require('./routes/dashboard'));

// signed document downloads
require('./routes/files').registerDownload(app);

// static frontend
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Ertiqaa ERP running on http://localhost:${config.port}`);
  });
}

module.exports = app;
