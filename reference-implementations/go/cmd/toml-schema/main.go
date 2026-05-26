package main

import (
	"fmt"
	"io"
	"os"

	tomlschema "github.com/brunoborges/toml-schema/reference-implementations/go"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, out, errOut io.Writer) int {
	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		usage(out)
		return 0
	}
	switch args[0] {
	case "validate":
		switch len(args) {
		case 2:
			return validateWithEmbeddedSchema(args[1], out, errOut)
		case 3:
			return validate(args[1], args[2], out, errOut)
		default:
			usage(errOut)
			return 2
		}
	case "extract":
		if len(args) != 3 {
			usage(errOut)
			return 2
		}
		return extract(args[1], args[2], out, errOut)
	default:
		fmt.Fprintf(errOut, "Unknown command: %s\n", args[0])
		usage(errOut)
		return 2
	}
}

func validateWithEmbeddedSchema(documentPath string, out, errOut io.Writer) int {
	schema, document, err := tomlschema.SchemaFromDocument(documentPath)
	if err != nil {
		fmt.Fprintln(errOut, err)
		return 2
	}
	return report(schema.Validate(document), documentPath, out, errOut)
}

func validate(schemaPath, documentPath string, out, errOut io.Writer) int {
	schema, err := tomlschema.LoadSchema(schemaPath)
	if err != nil {
		fmt.Fprintln(errOut, err)
		return 2
	}
	return report(schema.ValidateFile(documentPath), documentPath, out, errOut)
}

func extract(documentPath, schemaPath string, out, errOut io.Writer) int {
	if err := tomlschema.ExtractSchemaFile(documentPath, schemaPath); err != nil {
		fmt.Fprintln(errOut, err)
		return 2
	}
	fmt.Fprintf(out, "Extracted schema to %s\n", schemaPath)
	return 0
}

func report(result tomlschema.ValidationResult, documentPath string, out, errOut io.Writer) int {
	if result.Valid() {
		fmt.Fprintf(out, "%s is valid\n", documentPath)
		return 0
	}
	fmt.Fprintf(errOut, "%s is invalid:\n", documentPath)
	for _, validationError := range result.Errors {
		fmt.Fprintf(errOut, "  - %s: %s\n", validationError.Path, validationError.Message)
	}
	return 1
}

func usage(stream io.Writer) {
	fmt.Fprintln(stream, "Usage:")
	fmt.Fprintln(stream, "  toml-schema validate <schema.tosd> <document.toml>")
	fmt.Fprintln(stream, "  toml-schema validate <document.toml>")
	fmt.Fprintln(stream, "  toml-schema extract <document.toml> <schema.tosd>")
}
