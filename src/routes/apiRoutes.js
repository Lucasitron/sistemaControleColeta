const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const configController = require('../controllers/configController');
const participantController = require('../controllers/participantController');
const financialController = require('../controllers/financialController');
const botController = require('../controllers/botController');

const router = express.Router();

router.get('/config', asyncHandler(configController.getConfig));
router.put('/settings', asyncHandler(configController.updateSettings));

router.get('/dashboard', asyncHandler(financialController.getDashboard));

router.post('/participants', asyncHandler(participantController.createParticipant));
router.put('/participants/:id', asyncHandler(participantController.updateParticipant));
router.delete('/participants/:id', asyncHandler(participantController.deleteParticipant));

router.post('/payments', asyncHandler(financialController.createPayment));
router.put('/payments/:id', asyncHandler(financialController.updatePayment));
router.delete('/payments/:id', asyncHandler(financialController.deletePayment));

router.post('/purchases', asyncHandler(financialController.createPurchase));
router.get('/purchases', asyncHandler(financialController.getPurchases));
router.put('/purchases/:id', asyncHandler(financialController.updatePurchase));
router.delete('/purchases/:id', asyncHandler(financialController.deletePurchase));

router.post('/justifications', asyncHandler(financialController.toggleJustification));

router.get('/bot/status', asyncHandler(botController.getStatus));
router.post('/bot/start', asyncHandler(botController.startBot));
router.get('/bot/groups', asyncHandler(botController.listGroups));
router.get('/bot/group-participants', asyncHandler(botController.listGroupParticipants));
router.post('/bot/charge', asyncHandler(botController.sendIndividualCharge));
router.post('/bot/campaign', asyncHandler(botController.startCampaign));
router.post('/bot/report', asyncHandler(botController.sendReport));
router.post('/bot/clear-session', asyncHandler(botController.clearSession));

module.exports = router;
