# LLM Field Notes

These pages are the durable, forkable version of the learning map. Each note
answers one question, proposes a small build, and names a failure mode worth
observing.

| Note | Question |
| --- | --- |
| [Tokens are the interface](tokens.md) | Why can't the model see words? |
| [Meaning in a vector](embeddings.md) | How does a model store meaning? |
| [Attention is a lookup](attention.md) | How does context enter the computation? |
| [Loss is a compass](training.md) | What does learning mean here? |
| [The transformer stack](transformers.md) | What is the machine made of? |
| [Scale changes the game](scaling.md) | Why does scale work? |
| [One token at a time](inference.md) | What happens at inference? |
| [Measure the thing](evaluation.md) | How do I know if it works? |
| [Give it a library](rag.md) | How can a model use my data? |
| [Teach, don't just prompt](finetuning.md) | When should I change the weights? |
| [Tools make a system](agents.md) | How does a model take action? |
| [Ship the boring parts](production.md) | What survives contact with users? |

The browser workbench is the executable companion: ingest a document, inspect
the graph, correct it, and export the internal representation.
