# 서버 백업 파일을 외장 디스크로 매일 맞추는 작은 컨테이너 (run.sh). compose 의 backup-files 서비스.
FROM alpine:3.20
RUN apk add --no-cache rsync tzdata
COPY run.sh /run.sh
RUN chmod 755 /run.sh
ENTRYPOINT ["/run.sh"]
