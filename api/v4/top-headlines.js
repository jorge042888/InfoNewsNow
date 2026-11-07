const { handleApi } = require('../../lib/handlers.js');

module.exports = (req, res) => handleApi(req, res, 'top-headlines');
