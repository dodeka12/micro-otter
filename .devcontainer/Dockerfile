FROM mcr.microsoft.com/playwright:v1.58.2-noble

ENV DEBIAN_FRONTEND=noninteractive

# Version pins mirror deploy/toolchain/versions.env, the canonical source. They exist so Docker
# layer caching stays stable across runs; tests/test_toolchain_scripts.py fails when they drift, so
# update both files together.
#
# Toolchain *locations* are intentionally not set here: deploy/toolchain/esp-idf/bootstrap.sh
# derives IDF_PATH, IDF_TOOLS_PATH, and MICROPYTHON_ROOT from MICRO_OTTER_TOOLCHAIN_DIR (default
# /opt), so baking a fixed path would pin the container to one install root.
ENV ESP_IDF_VERSION=v5.5.2
ENV MICROPYTHON_VERSION=v1.29.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        bison \
        ccache \
        cmake \
        curl \
        dfu-util \
        flex \
        git \
        gh \
        gperf \
        libffi-dev \
        libssl-dev \
        libusb-1.0-0 \
        ninja-build \
        pandoc \
        python3 \
        python3-pip \
        python3-setuptools \
        python3-venv \
        python3-wheel \
        ripgrep \
        wget \
        wkhtmltopdf \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && ln -sf /root/.local/bin/uv /usr/local/bin/uv

# The ESP-IDF launcher is not baked into the image: deploy/toolchain/esp-idf/idf.py is the single
# implementation and .devcontainer/link-idf-launcher.sh links it onto PATH during postCreateCommand.
