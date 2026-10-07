package nativeapp

import (
	"context"
	"encoding/json"
	"local.codex.monitor/internal/monitor"
)

type response struct {
	Event string
	Data  json.RawMessage
}
type Client struct {
	native *monitor.Service
	events chan response
	done   chan struct{}
}

func startNativeClient(config monitor.Config) (*Client, error) {
	service, err := monitor.Start(config)
	if err != nil {
		return nil, err
	}
	c := &Client{native: service, events: make(chan response, 64), done: make(chan struct{})}
	go func() {
		defer close(c.done)
		defer close(c.events)
		for event := range service.Events {
			b, _ := json.Marshal(event.Data)
			select {
			case c.events <- response{Event: event.Name, Data: b}:
			default:
			}
		}
	}()
	return c, nil
}
func (c *Client) Call(ctx context.Context, method string, args any) (json.RawMessage, error) {
	return c.native.Call(ctx, method, args)
}
func (c *Client) Close() { c.native.Close(); <-c.done }
