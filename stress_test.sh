#!/bin/bash
RPW=$(grep REDIS_PASSWORD .env | cut -d'=' -f2 | tr -d '\r')
for i in {1..10}
do
  TASK_ID="TS-STRESS-$(date +%s)-$i"
  echo "Pushing Task: $TASK_ID"
  docker exec -it openclaw-redis redis-cli -a "$RPW" PUBLISH openclaw:tasks "{\"task_id\": \"$TASK_ID\", \"action\": \"scaling_test\", \"payload\": {\"sequence\": $i}}"
  sleep 2
done
