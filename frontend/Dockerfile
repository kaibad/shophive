# =========================================
# Stage 1: Build React (Vite) Application
# =========================================

ARG NODE_VERSION=24.14.0-alpine
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
ARG VITE_DJANGO_BASE_URL
RUN npm run build

# =========================================
# Stage 2: Serve with nginx
# =========================================

FROM nginx:alpine AS runner
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g" , "daemon off;"]

