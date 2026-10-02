ARG BASE_IMAGE=plow-hours:base
FROM ${BASE_IMAGE}
USER root
ENV PLOW_HOURS=1 PLOW_THREAD_TRUST=untrusted
COPY examples/contractor-hours/AGENTS.md /opt/plow/contractor-hours-prompt.md
RUN cat /opt/plow/contractor-hours-prompt.md >> /opt/plow/prompt/AGENTS.md && rm /opt/plow/contractor-hours-prompt.md
COPY examples/contractor-hours/skill /opt/plow/skills/contractor-hours
USER node
