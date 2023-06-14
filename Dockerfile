FROM node:18-alpine

# Copy function code
COPY . ${LAMBDA_TASK_ROOT}

RUN npm ci --omit=dev

EXPOSE 9000

CMD node local.js