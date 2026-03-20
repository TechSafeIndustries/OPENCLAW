'use strict';
const { Firestore } = require('@google-cloud/firestore');
const { log } = require('./logger');
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'tsi-automation';
function createFirestoreClient(databaseId) {
  var db = new Firestore({ projectId: PROJECT_ID, databaseId: databaseId === '(default)' ? undefined : databaseId });
  return {
    async checkApproval(batchRef) {
      var subject = 'CDMS batch: ' + batchRef;
      var snapshot = await db.collection('approval-receipts').where('subject', '==', subject).where('state', '==', 'APPROVED').orderBy('created_at', 'desc').limit(1).get();
      if (snapshot.empty) return null;
      var doc = snapshot.docs[0];
      return { id: doc.id, approvedBy: doc.data().approved_by || doc.data().created_by, timestamp: doc.data().created_at };
    },
    async writePatrolRun(runDoc) {
      var ref = db.collection('patrol-runs').doc(runDoc.id);
      await ref.set(Object.assign({}, runDoc, { created_at: Firestore.Timestamp.fromDate(new Date()), updated_at: Firestore.Timestamp.fromDate(new Date()) }));
      log('firestore-write', { collection: 'patrol-runs', docId: runDoc.id });
      return ref;
    },
    async writeFinding(findingDoc) {
      var ref = db.collection('patrol-findings').doc(findingDoc.id);
      await ref.set(Object.assign({}, findingDoc, { created_at: Firestore.Timestamp.fromDate(new Date()), updated_at: Firestore.Timestamp.fromDate(new Date()) }));
      return ref;
    },
    async writeFindings(findings) {
      if (findings.length === 0) return;
      var batchSize = 500;
      for (var i = 0; i < findings.length; i += batchSize) {
        var chunk = findings.slice(i, i + batchSize);
        var batch = db.batch();
        for (var j = 0; j < chunk.length; j++) {
          var ref = db.collection('patrol-findings').doc(chunk[j].id);
          batch.set(ref, Object.assign({}, chunk[j], { created_at: Firestore.Timestamp.fromDate(new Date()), updated_at: Firestore.Timestamp.fromDate(new Date()) }));
        }
        await batch.commit();
        log('firestore-batch-write', { collection: 'patrol-findings', count: chunk.length, offset: i });
      }
    },
    async writeException(ewrDoc) {
      var ref = db.collection('exceptions').doc(ewrDoc.id);
      await ref.set(Object.assign({}, ewrDoc, { created_at: Firestore.Timestamp.fromDate(new Date()), updated_at: Firestore.Timestamp.fromDate(new Date()) }));
      log('firestore-write', { collection: 'exceptions', docId: ewrDoc.id, type: 'EWR' });
      return ref;
    },
  };
}
module.exports = { createFirestoreClient: createFirestoreClient };
