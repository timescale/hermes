# Testing Hermes in a VM

Testing Hermes in a VM can be useful for validating that it works in a clean environment, and for testing on different operating systems. Here's how to set up and test Hermes in a VM:

## Using Tart

Tart uses native MacOS virtualization, so it is very fast. It doesn't support nested virtualization, so you need to proxy to the host's Docker socket to run the Hermes Docker containers.

```bash
brew install cirruslabs/cli/tart
tart clone ghcr.io/cirruslabs/macos-sequoia-base:latest sequoia-base
tart run sequoia-base --dir=hermes:~/dev/timescale/hermes/bin
```

In another terminal:

```bash
socat TCP-LISTEN:2375,reuseaddr,fork,bind=0.0.0.0 UNIX-CONNECT:/var/run/docker.sock
```

Inside the VM terminal:

```bash
brew install docker
export DOCKER_HOST=tcp://host.docker.internal:2375
/Volumes/My\ Shared\ Files/hermes/hermes
```
