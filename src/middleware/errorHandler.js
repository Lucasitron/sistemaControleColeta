function errorHandler(error, request, response, next) {
    console.error(error);
    response.status(error.statusCode || 400).json({
        error: error.message || 'Erro inesperado.'
    });
}

module.exports = errorHandler;
