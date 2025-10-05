#!/usr/bin/env bash

function iterate_recursive(){
        local dir="$1"
        for item in "$dir"/*; do
                echo "### $item"
                if [ -d "$item" ]; then
                        echo "dir: $item"
                        iterate_recursive "$item"
                else
                        cat "$item"
                fi
        done
}

iterate_recursive "./"
