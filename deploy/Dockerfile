# PocketBase para Shulius Vintage Server Manager.
# Versión pineada a la que está probada con los hooks/migraciones del repo.
FROM alpine:3.20

ARG PB_VERSION=0.38.1

RUN apk add --no-cache ca-certificates wget unzip \
    && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -O /tmp/pb.zip \
    && unzip /tmp/pb.zip -d /pb \
    && rm /tmp/pb.zip \
    && apk del unzip

WORKDIR /pb
EXPOSE 8090

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090"]
